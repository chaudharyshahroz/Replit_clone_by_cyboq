import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { Check, ChevronRight, Minus, Plug } from 'lucide-react';
import { checkDatabaseHealth, db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { describeAllProviders, listConnections } from '@reklu/integrations';
import { features } from '@reklu/shared';
import { Button } from '@/components/ui/button';
import { getAppContext } from '@/lib/auth-context';
import { signOutAction } from '@/app/(auth)/actions';

export const metadata: Metadata = { title: 'Settings' };

/** Spec §111: every capability states plainly whether it is configured. */
const CAPABILITIES: readonly {
  label: string;
  flag: keyof ReturnType<typeof features>;
  env: string;
}[] = [
  { label: 'Anthropic', flag: 'anthropic', env: 'ANTHROPIC_API_KEY' },
  { label: 'OpenAI', flag: 'openai', env: 'OPENAI_API_KEY' },
  { label: 'Google', flag: 'google', env: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { label: 'xAI', flag: 'xai', env: 'XAI_API_KEY' },
  { label: 'DeepSeek', flag: 'deepseek', env: 'DEEPSEEK_API_KEY' },
  { label: 'Embeddings', flag: 'embeddings', env: 'OPENAI_API_KEY' },
  { label: 'Web search', flag: 'webSearch', env: 'SEARCH_PROVIDER' },
  { label: 'Image generation', flag: 'imageGeneration', env: 'IMAGE_PROVIDER' },
  { label: 'Video generation', flag: 'videoGeneration', env: 'VIDEO_PROVIDER' },
  { label: 'Google sign-in', flag: 'googleSignIn', env: 'AUTH_GOOGLE_ID' },
  { label: 'GitHub sign-in', flag: 'githubSignIn', env: 'AUTH_GITHUB_ID' },
  { label: 'GitHub repositories', flag: 'githubIntegration', env: 'GITHUB_APP_CLIENT_ID' },
  { label: 'Vercel deployment', flag: 'vercelIntegration', env: 'VERCEL_CLIENT_ID' },
  { label: 'Supabase', flag: 'supabaseIntegration', env: 'SUPABASE_CLIENT_ID' },
  { label: 'Billing', flag: 'billing', env: 'STRIPE_SECRET_KEY' },
  { label: 'Durable storage', flag: 'durableStorage', env: 'STORAGE_DRIVER=s3' },
  { label: 'Isolated sandbox', flag: 'isolatedSandbox', env: 'SANDBOX_DRIVER' },
];

function limitText(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString();
}

export default async function SettingsPage() {
  const { user, workspace } = await getAppContext();
  const available = features();

  const providerConfigs = describeAllProviders();
  const configuredProviders = providerConfigs.filter((entry) => entry.configured).length;
  const totalProviders = providerConfigs.length;
  const connectionCount = (await listConnections(workspace.workspaceId)).length;

  const [planRow, health] = await Promise.all([
    db
      .select({ name: plans.name, limits: plans.limits, status: subscriptions.status })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
    checkDatabaseHealth(),
  ]);

  const plan = planRow[0];
  const limits = plan?.limits as PlanLimits | undefined;

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="display text-3xl text-text">Settings</h1>

      {/* ---- Account ------------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Account</h2>
        <dl className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {[
            ['Name', user.name ?? '—'],
            ['Email', user.email],
            ['Email verified', user.emailVerified ? 'Yes' : 'Not yet'],
            ['Workspace', `${workspace.workspaceName} (${workspace.role})`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 bg-surface/40 px-5 py-3.5">
              <dt className="text-sm text-text-secondary">{label}</dt>
              <dd className="truncate text-sm text-text">{value}</dd>
            </div>
          ))}
        </dl>

        <form action={signOutAction} className="mt-4">
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </section>

      {/* ---- Plan ---------------------------------------------------------- */}
      {plan && limits ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium text-text">Plan</h2>
          <p className="mt-1.5 text-sm text-text-secondary">
            {plan.name} · {plan.status}
          </p>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {[
              ['AI units / month', limitText(limits.aiUnitsPerMonth)],
              ['Deep Research / month', limitText(limits.deepResearchPerMonth)],
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
        </section>
      ) : null}

      {/* ---- Connections ---------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">Connections</h2>
        <p className="mt-1.5 text-sm text-text-secondary">
          Services Reklu can act on your behalf with. Tokens are encrypted at rest.
        </p>

        <Link
          href="/settings/connections"
          className="mt-4 flex items-center justify-between rounded-xl border border-border bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
        >
          <span className="flex items-center gap-3">
            <Plug className="h-4 w-4 text-text-secondary" strokeWidth={1.5} />
            <span className="text-sm text-text">Manage connections</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-text-muted">
            {connectionCount > 0
              ? `${connectionCount} connected`
              : `${configuredProviders} of ${totalProviders} available`}
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </Link>
      </section>

      {/* ---- System status -------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">System status</h2>
        <p className="mt-1.5 text-sm text-text-secondary">
          What this instance can actually do. Nothing here is simulated.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span
            className={`rounded-md border px-2.5 py-1 text-xs ${
              health.ok
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-danger/40 bg-danger/10 text-danger'
            }`}
          >
            Database {health.ok ? `healthy (${health.latencyMs}ms)` : 'unreachable'}
          </span>
          <span
            className={`rounded-md border px-2.5 py-1 text-xs ${
              health.vectorEnabled
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border-strong text-text-muted'
            }`}
          >
            pgvector {health.vectorEnabled ? 'enabled' : 'unavailable'}
          </span>
        </div>

        <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
          {CAPABILITIES.map((capability) => {
            const on = Boolean(available[capability.flag]);
            return (
              <li
                key={capability.label}
                className="flex items-center justify-between gap-3 bg-canvas px-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm text-text">
                  {on ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} />
                  ) : (
                    <Minus className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
                  )}
                  {capability.label}
                </span>
                {!on ? (
                  <code className="truncate font-mono text-[0.6875rem] text-text-muted">
                    {capability.env}
                  </code>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
