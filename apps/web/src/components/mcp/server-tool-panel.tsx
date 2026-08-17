'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  approveSchemaAction,
  deleteServerAction,
  rediscoverAction,
  setToolEnabledAction,
  type McpFormState,
} from '@/app/(app)/settings/mcp/actions';

interface ServerState {
  readonly id: string;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly schemaApproved: boolean;
  readonly enabledCount: number;
  readonly toolCount: number;
  readonly lastDiscoveredAt: string | null;
}

interface ToolRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly riskClass: string;
  readonly riskDescription: string;
  readonly enabled: boolean;
  readonly autoApproveReads: boolean;
  readonly executionCount: number;
}

/** Only read-only tools may ever run without a per-call prompt. */
const RISK_TONE: Record<string, string> = {
  read_only: 'border-success-border bg-success-subtle text-success',
  create: 'border-border bg-surface-raised text-text-secondary',
  update: 'border-border bg-surface-raised text-text-secondary',
  delete: 'border-warning/40 bg-warning/5 text-warning',
  financial: 'border-warning/40 bg-warning/5 text-warning',
  security_sensitive: 'border-danger-border bg-danger-subtle text-danger',
};

export function ServerToolPanel({
  server,
  tools,
}: {
  server: ServerState;
  tools: readonly ToolRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<McpFormState>): void => {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setError(result.error ?? null);
      setNotice(result.notice ?? null);
      router.refresh();
    });
  };

  return (
    <div className="mt-8 space-y-6">
      {error ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
          {notice}
        </p>
      ) : null}

      {/*
        The approval gate. Until this is satisfied every call is refused, so it
        goes first and says exactly what it means.
      */}
      {!server.schemaApproved ? (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={2} />
            These tool definitions need review
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {server.statusDetail ??
              'Reklu has not been told these definitions are what you expect. No tool from this server will run until you approve them.'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Read the descriptions below before approving. A tool&rsquo;s description is
            what the model acts on, so a changed description is a changed tool.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveSchemaAction(server.id))}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
          >
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
            Approve these definitions
          </button>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-text">
            Tools · {server.enabledCount} of {server.toolCount} enabled
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => rediscoverAction(server.id))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text hover:bg-surface-hover disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Re-check
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                run(async () => {
                  const result = await deleteServerAction(server.id);
                  if (!result.error) router.push('/settings/mcp');
                  return result;
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Remove
            </button>
          </div>
        </div>

        <ul className="mt-4 space-y-3">
          {tools.map((tool) => (
            <li key={tool.id} className="rounded-lg border border-border bg-surface p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs text-text">{tool.name}</code>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    RISK_TONE[tool.riskClass] ?? RISK_TONE.update
                  }`}
                >
                  {tool.riskClass.replace(/_/g, ' ')}
                </span>
                {tool.executionCount > 0 ? (
                  <span className="text-[11px] text-text-muted">
                    ran {tool.executionCount}×
                  </span>
                ) : null}
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                {tool.description ?? 'No description provided.'}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">{tool.riskDescription}</p>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    disabled={pending}
                    onChange={(event) =>
                      run(() => setToolEnabledAction(tool.id, event.target.checked))
                    }
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  Enabled
                </label>

                {/*
                  Offered only for read-only tools. Everything else asks every
                  time, and no setting changes that.
                */}
                {tool.riskClass === 'read_only' ? (
                  <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={tool.autoApproveReads}
                      disabled={pending || !tool.enabled}
                      onChange={(event) =>
                        run(() =>
                          setToolEnabledAction(tool.id, tool.enabled, event.target.checked),
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                    Run without asking
                  </label>
                ) : (
                  <span className="text-[11px] text-text-muted">Always asks before running</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
