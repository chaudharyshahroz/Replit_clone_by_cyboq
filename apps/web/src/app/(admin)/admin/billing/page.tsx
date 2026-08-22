import type { Metadata } from 'next';
import { billingConfig } from '@reklu/billing';
import Link from 'next/link';
import { listModels, listPlans, revenueSummary, spendBreakdown } from '@/lib/admin-data';
import { PlanEditor } from '@/components/admin/plan-editor';
import { NewPlan } from '@/components/admin/new-plan';
import { TIER_WEIGHT } from '@reklu/ai';

export const metadata: Metadata = { title: 'Admin · Billing' };
export const dynamic = 'force-dynamic';

export default async function AdminBillingPage() {
  const [plansList, modelList, spend, revenue, config] = await Promise.all([
    listPlans(),
    listModels(),
    spendBreakdown(30),
    revenueSummary(),
    Promise.resolve(billingConfig()),
  ]);

  const totalCost = spend.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-text">Payment provider</h2>
          <Link href="/admin/billing/diagnostics" className="text-xs text-accent hover:underline">
            Why a payment did not become a plan
          </Link>
        </div>
        <p
          className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            config.available
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-warning/40 bg-warning/5 text-text-secondary'
          }`}
        >
          {config.detail}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Revenue</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: 'Monthly recurring',
              value: revenue.monthlyRecurringUsd,
              /* What active subscriptions imply, not money in the bank. */
              hint: 'If nobody cancels',
            },
            { label: 'Collected, 30 days', value: revenue.collected30dUsd, hint: 'Actually charged' },
            { label: 'Collected, all time', value: revenue.collectedAllTimeUsd, hint: 'Actually charged' },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-surface/40 p-4">
              <p className="text-xs text-text-muted">{card.label}</p>
              <p className="mt-1 text-2xl tabular-nums text-text">
                ${card.value.toFixed(2)}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-text-muted">{card.hint}</p>
            </div>
          ))}
          <div className="rounded-xl border border-border bg-surface/40 p-4">
            <p className="text-xs text-text-muted">Paying workspaces</p>
            <p className="mt-1 text-2xl tabular-nums text-text">{revenue.payingWorkspaces}</p>
            <p className="mt-0.5 text-[0.6875rem] text-text-muted">Have paid at least once</p>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-muted">
              <tr className="bg-surface-raised">
                <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Subscribers</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Monthly recurring</th>
              </tr>
            </thead>
            <tbody>
              {revenue.byPlan.map((row) => (
                <tr key={row.key} className="border-t border-border bg-surface">
                  <td className="px-3 py-2 text-text">{row.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    ${Number(row.priceMonthlyUsd).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {row.subscribers}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text">
                    ${row.monthlyRecurringUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-text">Plans</h2>
          <NewPlan />
        </div>
        <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-muted">
          Plans are defined here. Saving one creates or updates its counterpart in
          Whop and publishes it to the billing page — no deploy, and no second
          copy of the price to keep in step.
        </p>
        <div className="mt-3">
          <PlanEditor
            models={modelList
              .filter((model) => model.enabled)
              .map((model) => ({
                key: model.key,
                displayName: model.displayName,
                costTier: model.costTier,
                // From the same table the meter uses, so the number shown is
                // the number charged.
                creditsPerThousandTokens:
                  TIER_WEIGHT[model.costTier as keyof typeof TIER_WEIGHT] ?? 1,
              }))}
            plans={plansList.map((plan) => ({
              id: plan.id,
              key: plan.key,
              name: plan.name,
              description: plan.description,
              priceMonthlyUsd: plan.priceMonthlyUsd,
              priceYearlyUsd: plan.priceYearlyUsd,
              yearlyEnabled: plan.yearlyEnabled,
              billingPeriodDays: plan.billingPeriodDays,
              currency: plan.currency,
              isPublic: plan.isPublic,
              isPurchasable: plan.isPurchasable,
              whopPlanId: plan.whopPlanId,
              whopPlanIdYearly: plan.whopPlanIdYearly,
              aiUnitsPerMonth: plan.limits.aiUnitsPerMonth,
              imageGenerationsPerMonth: plan.limits.imageGenerationsPerMonth,
              deepResearchPerMonth: plan.limits.deepResearchPerMonth,
              workspaceMembersMax: plan.limits.workspaceMembersMax,
              allowedModelKeys: plan.limits.allowedModelKeys,
              // Serialised for the client boundary; Date does not cross it.
              whopSyncedAt: plan.whopSyncedAt ? plan.whopSyncedAt.toISOString() : null,
              whopSyncError: plan.whopSyncError,
              subscribers: plan.subscribers,
            }))}
          />
        </div>
      </section>

      <section>
        <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-text">
          Provider spend · last 30 days
          <span className="text-xs font-normal text-text-muted">
            ${totalCost.toFixed(2)} total — what Reklu paid, not revenue
          </span>
        </h2>

        {spend.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No usage recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Provider spend by model and operation</caption>
              <thead>
                <tr className="bg-surface-raised text-left text-[0.6875rem] uppercase tracking-wider text-text-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Model</th>
                  <th scope="col" className="px-3 py-2 font-medium">Operation</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Calls</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {spend.map((row) => (
                  <tr
                    key={`${row.modelKey}-${row.operation}`}
                    className="border-t border-border bg-surface"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-text">{row.modelKey ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">{row.operation}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                      {row.calls.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                      {Math.round(row.units).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text">
                      ${row.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
