import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { checkQuota } from '@reklu/ai';
import { billingConfig, createCheckoutSession } from '@reklu/billing';
import { db, plans, subscriptions } from '@reklu/database';
import { asc, eq } from 'drizzle-orm';
import { isRekluError, logger } from '@reklu/shared';
import { absoluteAppUrl } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';
import { WhopCheckout } from '@/components/billing/whop-checkout';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; status?: string }>;
}) {
  const { workspace } = await getAppContext();
  const { plan: wanted, status } = await searchParams;

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
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      whopPlanId: plans.whopPlanId,
    })
    .from(plans)
    .where(eq(plans.isPurchasable, true))
    .orderBy(asc(plans.priceMonthlyUsd));

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
        // Prefer the synced plan; describe it inline if it has never synced,
        // so a newly created plan is buyable immediately.
        whopPlanId: chosen.whopPlanId ?? undefined,
        companyId: config.companyId,
        plan: {
          key: chosen.key,
          title: chosen.name,
          description: chosen.description,
          priceUsd: Number(chosen.priceMonthlyUsd),
          billingPeriodDays: chosen.billingPeriodDays,
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
            <p className="mt-2 text-[11px] text-text-muted">
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
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {purchasable.map((plan) => (
              <Link
                key={plan.key}
                href={`/settings/billing?plan=${plan.key}`}
                className="rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong"
              >
                <p className="text-sm font-medium text-text">{plan.name}</p>
                <p className="mt-1 text-2xl text-text">
                  ${Number(plan.priceMonthlyUsd).toFixed(0)}
                  <span className="text-sm text-text-muted"> /month</span>
                </p>
                {plan.description ? (
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    {plan.description}
                  </p>
                ) : null}
                <span className="mt-3 inline-block text-xs font-medium text-accent">
                  Choose {plan.name} →
                </span>
              </Link>
          ))}
        </section>
      )}
    </div>
  );
}
