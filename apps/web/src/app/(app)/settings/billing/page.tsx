import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { checkQuota } from '@reklu/ai';
import { billingConfig, createCheckoutSession } from '@reklu/billing';
import { aiModels, db, payments as paymentsTable, plans, subscriptions } from '@reklu/database';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { isRekluError, logger } from '@reklu/shared';
import { absoluteAppUrl } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';
import { WhopCheckout } from '@/components/billing/whop-checkout';
import { UpgradeButton } from '@/components/billing/upgrade-button';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; status?: string; period?: string }>;
}) {
  const { workspace } = await getAppContext();
  const { plan: wanted, status, period } = await searchParams;
  const yearly = period === 'yearly';

  const config = billingConfig();
  const quota = await checkQuota(workspace.workspaceId);

  const [current] = await db
    .select({
      key: plans.key,
      name: plans.name,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspace.workspaceId))
    .limit(1);

  /*
   * Prices come from the plans table, not from constants in this file. They
   * have to match what is configured in Whop — Reklu displays the price but
   * Whop is what actually charges, so a mismatch here would advertise one
   * number and take another.
   */
  /*
   * Whatever an administrator has marked purchasable — not a hard-coded pair.
   * Adding a tier in the admin panel makes it appear here with no deploy.
   */
  const purchasable = await db
    .select({
      key: plans.key,
      name: plans.name,
      description: plans.description,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      priceYearlyUsd: plans.priceYearlyUsd,
      yearlyEnabled: plans.yearlyEnabled,
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      whopPlanId: plans.whopPlanId,
      whopPlanIdYearly: plans.whopPlanIdYearly,
      limits: plans.limits,
    })
    .from(plans)
    .where(eq(plans.isPurchasable, true))
    .orderBy(asc(plans.priceMonthlyUsd));

  /* How many models exist, so a plan can say "all of them" truthfully. */
  const [modelCount] = await db
    .select({ total: sql<number>`count(*)` })
    .from(aiModels)
    .where(eq(aiModels.enabled, true));
  const totalModels = Number(modelCount?.total ?? 0);

  const chosen = wanted ? purchasable.find((plan) => plan.key === wanted) : undefined;

  /* What has actually been charged, from the payments the webhook recorded. */
  const payments = await db
    .select({
      id: paymentsTable.id,
      amountUsd: paymentsTable.amountUsd,
      createdAt: paymentsTable.createdAt,
      planName: plans.name,
    })
    .from(paymentsTable)
    .leftJoin(plans, eq(paymentsTable.planId, plans.id))
    .where(eq(paymentsTable.workspaceId, workspace.workspaceId))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(20);

  const returnUrl = absoluteAppUrl('/settings/billing');

  /*
   * The session is minted here, on the server, because that is the only way
   * the workspace id reaches the webhook. A failure is reported rather than
   * rendering an embed that would take a payment nobody could attribute.
   */
  let session: { id: string; whopPlanId?: string | undefined } | undefined;
  let checkoutError: string | undefined;

  if (chosen && config.available && config.apiKey) {
    try {
      session = await createCheckoutSession({
        apiKey: config.apiKey,
        workspaceId: workspace.workspaceId,
        returnUrl,
        planKey: chosen.key,
        /*
         * The period decides which Whop plan is bought. They are separate
         * objects with separate prices, so picking the wrong one would charge
         * a yearly buyer a monthly rate — or worse, monthly forever.
         */
        whopPlanId:
          (yearly && chosen.yearlyEnabled
            ? chosen.whopPlanIdYearly
            : chosen.whopPlanId) ?? undefined,
        companyId: config.companyId,
        plan: {
          key: yearly && chosen.yearlyEnabled ? `${chosen.key}-yearly` : chosen.key,
          title: yearly && chosen.yearlyEnabled ? `${chosen.name} (yearly)` : chosen.name,
          description: chosen.description,
          priceUsd:
            yearly && chosen.yearlyEnabled
              ? Number(chosen.priceYearlyUsd)
              : Number(chosen.priceMonthlyUsd),
          billingPeriodDays: yearly && chosen.yearlyEnabled ? 365 : chosen.billingPeriodDays,
          currency: chosen.currency,
        },
      });
    } catch (error) {
      checkoutError = isRekluError(error)
        ? error.userMessage
        : 'Could not start checkout. Please try again.';
      logger.error('Could not create a Whop checkout session', { error });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Settings
      </Link>

      <header className="mt-4">
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <CreditCard className="h-6 w-6 text-accent" strokeWidth={1.5} />
          Billing
        </h1>
      </header>

      {/* Checkout outcome, reported from the return URL. */}
      {status === 'success' ? (
        <p role="status" className="mt-6 rounded-lg border border-success-border bg-success-subtle px-3.5 py-3 text-sm text-text">
          Payment received. Your plan updates as soon as Whop confirms it —
          usually within a few seconds.
        </p>
      ) : null}
      {status === 'error' ? (
        <p role="alert" className="mt-6 rounded-lg border border-warning/40 bg-warning/5 px-3.5 py-3 text-sm text-text-secondary">
          Checkout did not complete. Nothing was charged.
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-text">Current plan</h2>
            <p className="mt-1.5 text-2xl text-text">{current?.name ?? 'Free'}</p>
            <p className="mt-1 text-xs text-text-muted">
              {current?.status === 'canceled'
                ? `Ends ${current.periodEnd ? new Date(current.periodEnd).toLocaleDateString() : 'at the end of the period'}`
                : current?.periodEnd
                  ? `Renews ${new Date(current.periodEnd).toLocaleDateString()}`
                  : 'No renewal date'}
            </p>
          </div>
          <Link href="/settings/usage" className="text-xs text-accent hover:underline">
            View usage
          </Link>
        </div>

      </section>

      {/*
        Spec §25: an unconfigured deployment says which variables are missing
        rather than rendering a checkout that cannot take money.
      */}
      {!config.available ? (
        <section className="mt-6 rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-sm font-medium text-text">Payments are not set up</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{config.detail}</p>
        </section>
      ) : chosen ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-text">Complete your upgrade</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            Payment is handled by Whop. Card details are entered on their form and
            never reach Reklu.
          </p>

          {checkoutError ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-text"
            >
              {checkoutError}
            </p>
          ) : session ? (
            <div className="mt-4">
              <WhopCheckout
                planId={session.whopPlanId ?? chosen.whopPlanId ?? ''}
                sessionId={session.id}
                returnUrl={returnUrl}
              />
            </div>
          ) : null}
        </section>
      ) : (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-text">Change plan</h2>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-text-muted">
            Compare what each plan includes, monthly or yearly.
          </p>
          <div className="mt-4">
            <UpgradeButton
              currentPlanKey={current?.key ?? null}
              plans={purchasable.map((plan) => ({
                key: plan.key,
                name: plan.name,
                description: plan.description,
                priceMonthlyUsd: plan.priceMonthlyUsd,
                priceYearlyUsd: plan.priceYearlyUsd,
                yearlyEnabled: plan.yearlyEnabled,
                aiUnitsPerMonth: plan.limits.aiUnitsPerMonth,
                imageGenerationsPerMonth: plan.limits.imageGenerationsPerMonth,
                deepResearchPerMonth: plan.limits.deepResearchPerMonth,
                workspaceMembersMax: plan.limits.workspaceMembersMax,
                allowedModelCount: plan.limits.allowedModelKeys.length,
                totalModelCount: totalModels,
              }))}
            />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-text">Payments</h2>
        {payments.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
            No payments yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface/40">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="min-w-0">
                  <span className="block text-sm text-text">{payment.planName ?? 'Payment'}</span>
                  <span className="block text-xs text-text-muted">
                    {new Date(payment.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-text">
                  ${Number(payment.amountUsd).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Spec §25: Reklu never sees a card, so it cannot show one. Saying where
        the details live is the honest version of a payment-method section —
        rendering a masked card Reklu does not hold would be an invention.
      */}
      <section className="mt-6 rounded-xl border border-border bg-surface/40 p-5">
        <h2 className="text-sm font-medium text-text">Payment method</h2>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-text-secondary">
          Cards are held by Whop, not by Reklu — they are entered on Whop&rsquo;s form and
          never reach us. Change or remove a card, or cancel a subscription, from your
          Whop account.
        </p>
        <a
          href="https://whop.com/orders"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          Manage on Whop
        </a>
      </section>
    </div>
  );
}