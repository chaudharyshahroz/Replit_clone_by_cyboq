import type { Metadata } from 'next';
import { dailyCost, errorRates, featureUsage, modelShare, retention, traffic } from '@/lib/admin-data';
import { TrafficChart } from '@/components/admin/traffic-chart';
import { CostChart } from '@/components/admin/cost-chart';

export const metadata: Metadata = { title: 'Admin · Analytics' };
export const dynamic = 'force-dynamic';

export default async function AdminAnalyticsPage() {
  const [points, costs, features, models, keep, errors] = await Promise.all([
    traffic(30),
    dailyCost(30),
    featureUsage(),
    modelShare(30),
    retention(),
    errorRates(),
  ]);

  const totalCalls = models.reduce((sum, row) => sum + row.calls, 0);
  const totalCost = costs.reduce((sum, row) => sum + row.costUsd, 0);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="display text-2xl text-text">Analytics</h1>
        {/*
          Said once, plainly. Reklu records what people did, not what they
          browsed — presenting activity as "visitors" would be a weaker number
          wearing a familiar name.
        */}
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
          Everything here is real activity — turns taken, features used, money
          spent. Reklu has no page-view or referrer tracking, so there are no
          visitor counts to show.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-text">Activity · last 30 days</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-5">
          <TrafficChart points={points} />
        </div>
      </section>

      <section>
        <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-medium text-text">
          Provider spend · last 30 days
          <span className="text-xs font-normal text-text-muted">
            ${totalCost.toFixed(2)} total
          </span>
        </h2>
        <div className="mt-3 rounded-xl border border-border bg-surface p-5">
          <CostChart points={costs} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Retention</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Total users" value={keep.totalUsers} />
          <Stat label="Active today" value={keep.activeToday} />
          <Stat label="Active 7d" value={keep.active7} />
          <Stat label="Active 30d" value={keep.active30} />
          {/* The number a signup count hides. */}
          <Stat
            label="Never returned"
            value={keep.neverReturned}
            tone={keep.neverReturned > keep.totalUsers / 2 ? 'warn' : 'plain'}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Feature usage</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <caption className="sr-only">Total and recent usage by feature</caption>
            <thead>
              <tr className="bg-surface-raised text-left text-[0.6875rem] uppercase tracking-wider text-text-muted">
                <th scope="col" className="px-3 py-2 font-medium">Feature</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">All time</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Last 7 days</th>
              </tr>
            </thead>
            <tbody>
              {features.map((row) => (
                <tr key={row.feature} className="border-t border-border bg-surface">
                  <td className="px-3 py-2 text-text">{row.feature}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {row.total.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {row.last7.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Model share · last 30 days</h2>
        {models.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No model calls recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {models.map((row) => {
              const share = totalCalls > 0 ? (row.calls / totalCalls) * 100 : 0;
              return (
                <li key={`${row.providerKey}-${row.modelKey}`} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="block text-[0.6875rem] uppercase tracking-wide text-text-muted">
                        {row.providerKey}
                      </span>
                      <code className="font-mono text-xs text-text">{row.modelKey}</code>
                    </div>
                    <span className="text-xs text-text-secondary">
                      {row.calls.toLocaleString()} calls · {row.tokens.toLocaleString()} tokens ·{' '}
                      {row.credits.toFixed(2)} credits · ${row.costUsd.toFixed(4)} ·{' '}
                      {share.toFixed(0)}%
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised"
                    role="img"
                    aria-label={`${share.toFixed(0)} percent of calls`}
                  >
                    <div className="h-full bg-accent" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Failures</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {errors.map((row) => {
            const rate = row.total > 0 ? (row.failed / row.total) * 100 : 0;
            return (
              <div key={row.label} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-[0.6875rem] uppercase tracking-wider text-text-muted">{row.label}</p>
                <p
                  className={`mt-1 text-xl tabular-nums ${
                    row.failed > 0 ? 'text-warning' : 'text-text'
                  }`}
                >
                  {row.failed.toLocaleString()}
                </p>
                <p className="text-[0.6875rem] text-text-muted">
                  of {row.total.toLocaleString()} · {rate.toFixed(1)}%
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[0.6875rem] uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-1 text-xl tabular-nums ${tone === 'warn' ? 'text-warning' : 'text-text'}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
