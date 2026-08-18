import type { Metadata } from 'next';
import { platformStats } from '@/lib/admin';
import { jobHealth, traffic } from '@/lib/admin-data';
import { TrafficChart } from '@/components/admin/traffic-chart';

export const metadata: Metadata = { title: 'Admin · Overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [stats, points, queues] = await Promise.all([platformStats(), traffic(30), jobHealth()]);

  const failed = queues.filter((row) => row.status === 'failed');

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Users" value={stats.users.toLocaleString()} />
        <Stat label="Workspaces" value={stats.workspaces.toLocaleString()} />
        <Stat label="Active 7d" value={stats.activeLast7Days.toLocaleString()} />
        <Stat label="Agent runs" value={stats.agentRuns.toLocaleString()} />
        <Stat label="AI units 30d" value={Math.round(stats.usageUnits30d).toLocaleString()} />
        <Stat
          label="Provider cost 30d"
          value={`$${stats.estimatedCostUsd30d.toFixed(2)}`}
          hint="what Reklu paid"
        />
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Traffic · last 30 days</h2>
        <div className="mt-3 rounded-xl border border-border bg-surface/40 p-5">
          <TrafficChart points={points} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Queues</h2>
        {queues.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No jobs have run yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {queues.map((row) => (
              <li
                key={`${row.queue}-${row.status}`}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  row.status === 'failed'
                    ? 'border-warning/40 bg-warning/5 text-warning'
                    : 'border-border bg-surface text-text-secondary'
                }`}
              >
                <span className="font-mono">{row.queue}</span> · {row.status} · {row.n}
              </li>
            ))}
          </ul>
        )}
        {failed.length > 0 ? (
          <p className="mt-2 text-xs text-warning">
            {failed.reduce((sum, row) => sum + row.n, 0)} failed job(s) need attention.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-xl tabular-nums text-text">{value}</p>
      {hint ? <p className="text-[10px] text-text-muted">{hint}</p> : null}
    </div>
  );
}
