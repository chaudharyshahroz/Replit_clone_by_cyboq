import type { Metadata } from 'next';
import { billingConfig } from '@reklu/billing';
import { listPlans, spendBreakdown } from '@/lib/admin-data';
import { PlanEditor } from '@/components/admin/plan-editor';

export const metadata: Metadata = { title: 'Admin · Billing' };
export const dynamic = 'force-dynamic';

export default async function AdminBillingPage() {
  const [plansList, spend, config] = await Promise.all([
    listPlans(),
    spendBreakdown(30),
    Promise.resolve(billingConfig()),
  ]);

  const totalCost = spend.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-text">Payment provider</h2>
        <p
          className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            config.available
              ? 'border-success-border bg-success-subtle text-success'
              : 'border-warning/40 bg-warning/5 text-text-secondary'
          }`}
        >
          {config.detail}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Plans</h2>
        <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-text-muted">
          Plans are defined here. Saving one creates or updates its counterpart in
          Whop and publishes it to the billing page — no deploy, and no second
          copy of the price to keep in step.
        </p>
        <div className="mt-3">
          <PlanEditor
            plans={plansList.map((plan) => ({
              id: plan.id,
              key: plan.key,
              name: plan.name,
              description: plan.description,
              priceMonthlyUsd: plan.priceMonthlyUsd,
              billingPeriodDays: plan.billingPeriodDays,
              currency: plan.currency,
              isPublic: plan.isPublic,
              isPurchasable: plan.isPurchasable,
              whopPlanId: plan.whopPlanId,
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
