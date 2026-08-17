import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { listFeatureFlags, platformStats, requireSuperAdmin, topWorkspaces } from '@/lib/admin';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  // Redirects a non-admin to /home rather than confirming this page exists.
  await requireSuperAdmin();

  const [stats, spaces, flags] = await Promise.all([
    platformStats(),
    topWorkspaces(),
    listFeatureFlags(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <h1 className="display flex items-center gap-2.5 text-3xl text-text">
          <ShieldCheck className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Admin
        </h1>
        <p className="mt-2 text-text-secondary">
          Platform-wide state. Visible only to super admins.
        </p>
      </header>

      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Users" value={stats.users.toLocaleString()} />
        <Stat label="Workspaces" value={stats.workspaces.toLocaleString()} />
        <Stat label="Active (7d)" value={stats.activeLast7Days.toLocaleString()} />
        <Stat label="Agent runs" value={stats.agentRuns.toLocaleString()} />
        <Stat label="AI units (30d)" value={Math.round(stats.usageUnits30d).toLocaleString()} />
        {/*
          What Reklu paid providers, not what customers were charged. Naming it
          precisely stops it being read as revenue.
        */}
        <Stat
          label="Provider cost (30d)"
          value={`$${stats.estimatedCostUsd30d.toFixed(2)}`}
          hint="What Reklu paid providers"
        />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Workspaces by usage</h2>
        {spaces.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No workspaces yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {spaces.map((space) => (
              <li key={space.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-text">{space.name}</span>
                <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                  {space.planName}
                </span>
                <span className="text-xs text-text-secondary">
                  {Math.round(space.usageUnits).toLocaleString()} units
                </span>
                <span className="text-[11px] text-text-muted">
                  {new Date(space.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Feature flags</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
          Read-only here. A flag is a rollout decision, and changing one from a
          dashboard with no audit trail is how a rollout becomes a mystery.
        </p>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {flags.map((flag) => (
            <li key={flag.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-2.5">
              <code className="font-mono text-xs text-text">{flag.key}</code>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  flag.enabled
                    ? 'border-success-border bg-success-subtle text-success'
                    : 'border-border bg-surface-raised text-text-muted'
                }`}
              >
                {flag.enabled ? 'on' : 'off'}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                {flag.description}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-2xl text-text">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-text-muted">{hint}</p> : null}
    </div>
  );
}
