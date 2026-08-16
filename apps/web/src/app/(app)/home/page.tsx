import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AlertTriangle, ArrowRight, Check, Sparkles } from 'lucide-react';
import { aiModels, aiProviders, db, plans, skills, subscriptions } from '@reklu/database';
import { features, type FeatureAvailability } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Home' };

/** Which env var backs each provider, so the UI can name the exact fix. */
const PROVIDER_FLAG: Record<string, keyof FeatureAvailability> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  xai: 'xai',
  deepseek: 'deepseek',
};

export default async function HomePage() {
  const { user, workspace } = await getAppContext();
  const available = features();

  const [modelRows, planRow, skillRows] = await Promise.all([
    db
      .select({
        key: aiModels.key,
        displayName: aiModels.displayName,
        description: aiModels.description,
        speed: aiModels.speed,
        costTier: aiModels.costTier,
        enabled: aiModels.enabled,
        providerKey: aiProviders.key,
        providerName: aiProviders.displayName,
        apiKeyEnvVar: aiProviders.apiKeyEnvVar,
      })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
      .where(eq(aiModels.enabled, true))
      .orderBy(asc(aiModels.sortOrder)),
    db
      .select({ name: plans.name, limits: plans.limits, status: subscriptions.status })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
    db
      .select({
        handle: skills.handle,
        name: skills.name,
        description: skills.description,
        category: skills.category,
      })
      .from(skills)
      .where(and(eq(skills.isBuiltIn, true), isNull(skills.deletedAt)))
      .orderBy(asc(skills.name)),
  ]);

  // Group by provider, preserving registry sort order.
  const byProvider = new Map<string, typeof modelRows>();
  for (const model of modelRows) {
    const list = byProvider.get(model.providerKey) ?? [];
    list.push(model);
    byProvider.set(model.providerKey, list);
  }

  const plan = planRow[0];
  const firstName = (user.name ?? '').split(' ')[0] || 'there';
  const configuredProviders = [...byProvider.keys()].filter(
    (key) => available[PROVIDER_FLAG[key] ?? 'anyModelProvider'],
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <h1 className="display text-3xl text-text">Welcome, {firstName}.</h1>
        <p className="mt-2 text-text-secondary">
          {workspace.workspaceName} · {plan ? `${plan.name} plan` : 'No plan'}
        </p>
      </header>

      {/*
        Spec §88/§137: state plainly that no model provider is configured, name
        the variables, and do not render a composer that could not work.
      */}
      {!available.anyModelProvider ? (
        <section className="mt-10 rounded-xl border border-warning/40 bg-warning/5 p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={2} />
            No AI provider is configured
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-secondary">
            The model registry below is live, but Reklu cannot send a request until this
            instance has a provider key. Add one to <code className="text-text">.env</code> and
            restart:
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'].map((v) => (
              <li
                key={v}
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1 font-mono text-xs text-text-secondary"
              >
                {v}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="mt-10 rounded-xl border border-success/30 bg-success/5 p-6">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <Check className="h-4 w-4 text-success" strokeWidth={2.25} />
            {configuredProviders.length} provider
            {configuredProviders.length === 1 ? '' : 's'} configured
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            Chat is not built yet, but the registry and routing inputs below are what it will
            read.
          </p>
        </section>
      )}

      {/* ---- Model registry: real rows from the database ------------------- */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text">Model registry</h2>
          <p className="text-xs text-text-muted">
            {modelRows.length} models · {byProvider.size} providers
          </p>
        </div>
        <p className="mt-1.5 text-sm text-text-secondary">
          Administrators enable, re-price, and re-prioritise these without a deploy.
        </p>

        <div className="mt-5 space-y-5">
          {[...byProvider.entries()].map(([providerKey, models]) => {
            const isConfigured = available[PROVIDER_FLAG[providerKey] ?? 'anyModelProvider'];
            const providerName = models[0]?.providerName ?? providerKey;
            const envVar = models[0]?.apiKeyEnvVar ?? '';

            return (
              <div key={providerKey}>
                <div className="flex items-center gap-2 pb-2">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                    {providerName}
                  </h3>
                  {isConfigured ? (
                    <span className="rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                      Configured
                    </span>
                  ) : (
                    <span
                      title={`Set ${envVar} to enable`}
                      className="rounded border border-border-strong px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted"
                    >
                      Not configured
                    </span>
                  )}
                </div>

                <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                  {models.map((model) => (
                    <li key={model.key} className="bg-canvas p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-text">{model.displayName}</p>
                        <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                          {model.speed} · {model.costTier}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                        {model.description}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Built-in skills: real rows ------------------------------------ */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text">Built-in Skills</h2>
          <Link href="/skills" className="rounded text-xs text-accent hover:text-accent-hover">
            View library
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {skillRows.map((skill) => (
            <li key={skill.handle} className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
                <p className="text-sm font-medium text-text">{skill.name}</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                {skill.description}
              </p>
              <p className="mt-2 font-mono text-[11px] text-text-muted">@{skill.handle}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Honest build status ------------------------------------------- */}
      <section className="mt-14 rounded-xl border border-border bg-surface/40 p-6">
        <h2 className="text-sm font-medium text-text">What is built so far</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Accounts, workspaces, sessions, the model registry, plans and Skills are real and
          backed by the database. Chat, Research, Build, Projects, Artifacts, Connections and
          Agents are not implemented yet — they are marked{' '}
          <span className="text-text-muted">Soon</span> in the sidebar rather than linking to
          pages that do not exist.
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-flex items-center gap-1.5 rounded text-sm text-accent hover:text-accent-hover"
        >
          View system status
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </section>
    </div>
  );
}
