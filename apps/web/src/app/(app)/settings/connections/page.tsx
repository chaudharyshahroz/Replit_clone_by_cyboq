import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Check, Github, Plug, Triangle, Database } from 'lucide-react';
import { describeAllProviders, listConnections } from '@reklu/integrations';
import { getAppContext } from '@/lib/auth-context';
import { ConnectionRow } from './connection-row';

export const metadata: Metadata = { title: 'Connections' };
export const dynamic = 'force-dynamic';

const ICONS: Record<string, typeof Github> = {
  github: Github,
  vercel: Triangle,
  supabase: Database,
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await getAppContext();
  const [connections, providers, query] = await Promise.all([
    listConnections(workspace.workspaceId),
    Promise.resolve(describeAllProviders()),
    searchParams,
  ]);

  const error = typeof query.error === 'string' ? query.error : undefined;
  const connected = typeof query.connected === 'string' ? query.connected : undefined;

  const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <Plug className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Connections
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Connect the services Reklu acts on your behalf with. Tokens are encrypted at rest and
          bound to this workspace — a copied database row cannot be decrypted elsewhere.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-text"
        >
          {error}
        </p>
      ) : null}

      {connected ? (
        <p className="mt-6 flex items-center gap-2 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm text-text">
          <Check className="h-4 w-4 text-success" strokeWidth={2} />
          Connected to {connected}.
        </p>
      ) : null}

      <ul className="mt-8 space-y-4">
        {providers.map(({ provider, configured, missingEnv, redirectUri }) => {
          const Icon = ICONS[provider.key] ?? Plug;
          const connection = byProvider.get(provider.key);

          return (
            <li
              key={provider.key}
              className="rounded-xl border border-border bg-surface/40 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 text-text-secondary" strokeWidth={1.5} />
                  <div>
                    <h2 className="text-sm font-medium text-text">{provider.displayName}</h2>
                    {connection ? (
                      <p className="mt-1 text-xs text-text-muted">
                        {connection.accountName} · connected{' '}
                        {new Date(connection.connectedAt).toLocaleDateString()}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {Object.values(provider.scopeDescriptions)[0]}
                      </p>
                    )}
                  </div>
                </div>

                {/*
                  Three distinct states, never conflated: not configured by the
                  operator, configured but not connected, and connected.
                */}
                {!configured ? (
                  <span className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted">
                    Not configured
                  </span>
                ) : connection ? (
                  <ConnectionRow
                    connectionId={connection.id}
                    status={connection.status}
                    statusDetail={connection.statusDetail}
                  />
                ) : (
                  <Link
                    href={`/api/integrations/${provider.key}/start?returnTo=/settings/connections`}
                    className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-on-accent transition-opacity hover:opacity-90"
                  >
                    Connect
                  </Link>
                )}
              </div>

              {/*
                An unconfigured provider names the exact variables an operator
                must set, and the callback URL to register (spec §25).
              */}
              {!configured ? (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <p className="flex items-center gap-2 text-xs font-medium text-text">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" strokeWidth={2} />
                    An administrator must set {missingEnv.join(' and ')}
                  </p>
                  <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-text-muted">
                    Register this callback URL with {provider.displayName}:{' '}
                    <code className="break-all text-text-secondary">{redirectUri}</code>
                  </p>
                </div>
              ) : null}

              {/* Consent is informed: every scope is spelled out in plain words. */}
              {configured && !connection ? (
                <dl className="mt-4 space-y-1.5 border-t border-border pt-3">
                  {Object.entries(provider.scopeDescriptions).map(([scope, description]) => (
                    <div key={scope} className="flex gap-2 text-[0.6875rem] leading-relaxed">
                      <dt className="shrink-0 font-mono text-text-secondary">{scope}</dt>
                      <dd className="text-text-muted">{description}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {connection && connection.scopes.length > 0 ? (
                <p className="mt-3 border-t border-border pt-3 text-[0.6875rem] text-text-muted">
                  Granted: {connection.scopes.join(', ')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-10 text-xs leading-relaxed text-text-muted">
        Disconnecting deletes the stored credentials outright rather than hiding them. To revoke
        Reklu&rsquo;s access at the source as well, remove the authorization in the provider&rsquo;s
        own settings.
      </p>
    
      {/* MCP servers live alongside OAuth connections: both are "things Reklu
          may act through", and both are managed here. */}
      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">MCP servers</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
          Connect a Model Context Protocol server to give Reklu access to its tools.
          Every tool arrives disabled and is reviewed before it can run.
        </p>
        <Link
          href="/settings/mcp"
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface-hover"
        >
          <Plug className="h-3.5 w-3.5" strokeWidth={1.75} />
          Manage MCP servers
        </Link>
      </section>
</div>
  );
}
