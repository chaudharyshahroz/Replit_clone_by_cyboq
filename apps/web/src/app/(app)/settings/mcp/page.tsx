import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Plug, ShieldQuestion } from 'lucide-react';
import { listExecutions, listServers } from '@reklu/mcp';
import { getAppContext } from '@/lib/auth-context';
import { ConnectServerForm } from '@/components/mcp/connect-server-form';

export const metadata: Metadata = { title: 'MCP servers' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
  error: 'Error',
};

export default async function McpPage() {
  const { workspace } = await getAppContext();
  const [servers, executions] = await Promise.all([
    listServers(workspace.workspaceId),
    listExecutions(workspace.workspaceId, 25),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <Plug className="h-6 w-6 text-accent" strokeWidth={1.5} />
          MCP servers
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Connect a Model Context Protocol server to give Reklu access to its tools.
        </p>
        {/*
          Stated before connecting, not discovered afterwards: connecting grants
          nothing on its own (spec §49).
        */}
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Connecting a server grants no access. Every tool arrives disabled, and
          anything that changes data asks before it runs.
        </p>
      </header>

      <div className="mt-8">
        <ConnectServerForm />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Your servers</h2>

        {servers.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm leading-relaxed text-text-secondary">
            No servers connected yet. Add one above — you will review its tools before
            anything can run.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {servers.map((server) => (
              <li key={server.id} className="rounded-xl border border-border bg-surface/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/settings/mcp/${server.id}`}
                    className="rounded text-sm font-medium text-text hover:text-accent"
                  >
                    {server.name}
                  </Link>
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide ${
                      server.status === 'connected'
                        ? 'border border-success/40 bg-success/10 text-success'
                        : 'border border-warning/40 bg-warning/5 text-warning'
                    }`}
                  >
                    {STATUS_LABEL[server.status] ?? server.status}
                  </span>
                  {!server.schemaApproved ? (
                    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-warning">
                      <ShieldQuestion className="h-3 w-3" strokeWidth={2} />
                      Needs review
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 truncate font-mono text-[0.6875rem] text-text-muted">
                  {server.endpoint}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {server.enabledCount} of {server.toolCount} tools enabled
                  {server.hasCredential ? ' · authenticated' : ''}
                </p>

                {server.statusDetail ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    {server.statusDetail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Audit trail ---------------------------------------------------
        Spec §49: every invocation is recorded, including denials. A log of
        only successes would not answer "what did the agent do?".
      */}
      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Recent tool activity</h2>

        {executions.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No tools have run yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {executions.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3 py-2.5">
                {run.status === 'succeeded' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2} />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} />
                )}
                <span className="font-mono text-xs text-text">{run.toolName}</span>
                <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-text-muted">
                  {run.riskClass.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-text-secondary">{run.status.replace(/_/g, ' ')}</span>
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-text-muted">
                  {run.deniedReason ?? run.errorMessage ?? ''}
                </span>
                <span className="text-[0.6875rem] text-text-muted">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
