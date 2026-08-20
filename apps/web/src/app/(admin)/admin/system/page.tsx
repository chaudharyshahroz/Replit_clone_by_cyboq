import type { Metadata } from 'next';
import { features, serverEnv } from '@reklu/shared';
import { listFeatureFlags } from '@/lib/admin';
import { adminAuditTrail } from '@/lib/admin-data';
import { FlagToggles } from '@/components/admin/flag-toggles';

export const metadata: Metadata = { title: 'Admin · System' };
export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  const [flags, trail] = await Promise.all([listFeatureFlags(), adminAuditTrail(40)]);
  const available = features();
  const env = serverEnv();

  const capabilities = [
    ['Model provider', available.anyModelProvider],
    ['Embeddings', available.embeddings],
    ['Web search', available.webSearch],
    ['Image generation', available.imageGeneration],
    ['Video generation', available.videoGeneration],
    ['Durable storage', available.durableStorage],
    ['Isolated sandbox', available.isolatedSandbox],
    ['Build', available.build],
    ['Billing', available.billing],
  ] as const;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-text">Capabilities</h2>
        <p className="mt-1.5 text-xs text-text-muted">
          Derived from the environment. A capability that is off is off because
          configuration is missing, not because it failed.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(([label, on]) => (
            <li
              key={label}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="text-text-secondary">{label}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide ${
                  on
                    ? 'border border-success-border bg-success-subtle text-success'
                    : 'border border-border bg-surface-raised text-text-muted'
                }`}
              >
                {on ? 'on' : 'off'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Deployment</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            ['Environment', env.NODE_ENV],
            ['App URL', env.APP_URL],
            ['Admin host', env.ADMIN_HOST ?? 'same host'],
            ['Storage driver', env.STORAGE_DRIVER],
            ['Sandbox driver', env.SANDBOX_DRIVER],
            ['Embedding provider', env.EMBEDDING_PROVIDER],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-[0.6875rem] uppercase tracking-wider text-text-muted">{label}</dt>
              <dd className="mt-0.5 font-mono text-xs text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Feature flags</h2>
        <div className="mt-3">
          <FlagToggles flags={flags.map((flag) => ({ ...flag }))} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text">Admin audit trail</h2>
        <p className="mt-1.5 text-xs text-text-muted">
          Every administrative action, including reads of private content.
        </p>
        {trail.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No admin actions recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {trail.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-2">
                <code className="font-mono text-xs text-text">{entry.action}</code>
                <span className="text-xs text-text-secondary">{entry.actorEmail ?? 'unknown'}</span>
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-text-muted">
                  {entry.resourceType} {entry.resourceId}
                </span>
                <span className="text-[0.6875rem] text-text-muted">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
