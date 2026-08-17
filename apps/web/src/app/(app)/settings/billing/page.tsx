import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { checkQuota } from '@reklu/ai';
import { billingConfig } from '@reklu/billing';
import { db, plans, subscriptions } from '@reklu/database';
import { eq } from 'drizzle-orm';
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

  const wantedPlanId =
    wanted === 'team' ? config.planIds.team : wanted === 'pro' ? config.planIds.pro : undefined;

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
      ) : wantedPlanId ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-text">Complete your upgrade</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            Payment is handled by Whop. Card details are entered on their form and
            never reach Reklu.
          </p>
          <div className="mt-4">
            <WhopCheckout
              planId={wantedPlanId}
              workspaceId={workspace.workspaceId}
              returnUrl={absoluteAppUrl('/settings/billing')}
            />
          </div>
        </section>
      ) : (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {(['pro', 'team'] as const)
            .filter((key) => config.planIds[key])
            .map((key) => (
              <Link
                key={key}
                href={`/settings/billing?plan=${key}`}
                className="rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong"
              >
                <p className="text-sm font-medium text-text">
                  {key === 'pro' ? 'Pro' : 'Team'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                  {key === 'pro'
                    ? 'More AI units, longer research runs, and priority models.'
                    : 'Everything in Pro, plus shared workspaces for your team.'}
                </p>
                <span className="mt-3 inline-block text-xs font-medium text-accent">
                  Choose {key === 'pro' ? 'Pro' : 'Team'} →
                </span>
              </Link>
            ))}
        </section>
      )}
    </div>
  );
}
