import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { checkQuota } from '@reklu/ai';
import { billingConfig, createCheckoutSession } from '@reklu/billing';
import { aiModels, db, plans, subscriptions } from '@reklu/database';
import { asc, eq, sql } from 'drizzle-orm';
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
    .select({ key: plans.key, name: plans.name, priceMonthlyUsd: plans.priceMonthlyUsd })
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
        <h2 className="text-sm font-medium text-text">Current plan</h2>
        <p className="mt-1.5 text-2xl text-text">{current?.name ?? 'Free'}</p>

        {quota ? (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-text-secondary">AI units this period</span>
              <span className="text-text-muted">
                {Math.round(quota.used)}
                {quota.limit === null ? ' used (unmetered)' : ` of ${quota.limit}`}
              </span>
            </div>
            {quota.limit !== null ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className={`h-full ${quota.exceeded ? 'bg-warning' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }}
                />
              </div>
            ) : null}
            <p className="mt-2 text-[0.6875rem] text-text-muted">
              Resets {new Date(quota.periodEnd).toLocaleDateString()}
            </p>
          </div>
        ) : null}
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
    </div>
  );
}
