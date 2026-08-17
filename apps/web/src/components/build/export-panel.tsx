'use client';

import { useState, useTransition } from 'react';
import { ExternalLink, Github, Loader2, Triangle, UploadCloud } from 'lucide-react';
import {
  deployToVercelAction,
  exportToGitHubAction,
  type ExportState,
} from '@/app/(app)/build/actions';

interface ExportPanelProps {
  readonly buildId: string;
  /** False before anything has been generated — nothing to export yet. */
  readonly hasFiles: boolean;
}

type Target = 'github' | 'vercel';

/**
 * Export a generated app to a connected service.
 *
 * Every state shown here is a real one. A deployment that Vercel reports as
 * building says "building" and does not present its URL as live (spec §137);
 * a missing connection reads as setup rather than as an error the user caused
 * (spec §25).
 */
export function ExportPanel({ buildId, hasFiles }: ExportPanelProps) {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<Target | null>(null);
  const [result, setResult] = useState<(ExportState & { target: Target }) | null>(null);

  const run = (target: Target): void => {
    setResult(null);
    setRunning(target);
    startTransition(async () => {
      const action = target === 'github' ? exportToGitHubAction : deployToVercelAction;
      const state = await action(buildId);
      setResult({ ...state, target });
      setRunning(null);
    });
  };

  const busy = pending || running !== null;

  return (
    <section className="rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-text">
        <UploadCloud className="h-4 w-4 text-accent" strokeWidth={1.75} />
        Export
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
        Push this app to your own GitHub repository, or deploy it to Vercel.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run('github')}
          disabled={busy || !hasFiles}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running === 'github' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Github className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {running === 'github' ? 'Pushing…' : 'Push to GitHub'}
        </button>

        <button
          type="button"
          onClick={() => run('vercel')}
          disabled={busy || !hasFiles}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running === 'vercel' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Triangle className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {running === 'vercel' ? 'Deploying…' : 'Deploy to Vercel'}
        </button>
      </div>

      {!hasFiles ? (
        <p className="mt-3 text-xs text-text-muted">
          Generate the app first — there are no files to export yet.
        </p>
      ) : null}

      {result?.error ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary"
        >
          {result.error}
        </p>
      ) : null}

      {result?.url ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5"
        >
          <p className="text-xs leading-relaxed text-text-secondary">{result.detail}</p>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            {result.target === 'github' ? 'Open repository' : 'Open deployment'}
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </a>
          {result.status === 'deploying' ? (
            <p className="mt-1.5 text-[11px] text-text-muted">
              This link will 404 until the build finishes.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
