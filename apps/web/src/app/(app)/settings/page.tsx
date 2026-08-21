import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { ChevronRight, CreditCard, Gauge, Plug, SlidersHorizontal } from 'lucide-react';
import { db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { describeAllProviders, listConnections } from '@reklu/integrations';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Settings' };

function limitText(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString();
}

export default async function SettingsPage() {
  const { workspace } = await getAppContext();

  const providerConfigs = describeAllProviders();
  const configuredProviders = providerConfigs.filter((entry) => entry.configured).length;
  const totalProviders = providerConfigs.length;
  const connectionCount = (await listConnections(workspace.workspaceId)).length;

  const [planRow] = await db
    .select({ name: plans.name, limits: plans.limits, status: subscriptions.status })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspace.workspaceId))
    .limit(1);

  const limits = planRow?.limits as PlanLimits | undefined;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <SlidersHorizontal className="h-6 w-6 text-accent" strokeWidth={1.5} />
          {workspace.workspaceName}
        </h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          What this workspace is on and what it can reach.
        </p>
      </header>

      {/* ---- Plan ---------------------------------------------------------- */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-text">Plan</h2>
          <Link href="/settings/billing" className="text-xs text-accent hover:underline">
            Manage
          </Link>
        </div>
        <p className="mt-1.5 text-sm text-text-secondary">
          {planRow ? `${planRow.name} · ${planRow.status}` : 'Free'}
        </p>

        {limits ? (
          <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {[
              ['AI credits / month', limitText(limits.aiUnitsPerMonth)],
              ['Deep research / month', limitText(limits.deepResearchPerMonth)],
              ['Build projects', limitText(limits.buildProjectsMax)],
              ['Images / month', limitText(limits.imageGenerationsPerMonth)],
              ['Upload size', `${limits.fileUploadMaxMb} MB`],
              ['Storage', `${limits.storageMaxGb} GB`],
              ['Members', limitText(limits.workspaceMembersMax)],
              ['Concurrent jobs', String(limits.concurrentJobsMax)],
            ].map(([label, value]) => (
              <div key={label} className="bg-canvas px-5 py-3.5">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="mt-0.5 text-sm text-text">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {/* ---- Shortcuts ------------------------------------------------------ */}
      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Elsewhere in settings</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Link
            href="/settings/usage"
            className="flex items-center justify-between rounded-xl border border-border bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
          >
            <span className="flex items-center gap-3">
              <Gauge className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
              <span className="text-sm text-text">Usage</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
          </Link>

          <Link
            href="/settings/billing"
            className="flex items-center justify-between rounded-xl border border-border bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
          >
            <span className="flex items-center gap-3">
              <CreditCard className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
              <span className="text-sm text-text">Billing</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
          </Link>

          <Link
            href="/settings/connections"
            className="flex items-center justify-between rounded-xl border border-border bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:col-span-2"
          >
            <span className="flex items-center gap-3">
              <Plug className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
              <span className="text-sm text-text">Connections</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-text-muted">
              {connectionCount > 0
                ? `${connectionCount} connected`
                : `${configuredProviders} of ${totalProviders} available`}
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
