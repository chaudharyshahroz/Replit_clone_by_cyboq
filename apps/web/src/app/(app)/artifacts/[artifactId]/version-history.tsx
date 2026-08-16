'use client';

import { useTransition } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { restoreVersionAction } from './actions';

interface VersionSummary {
  readonly id: string;
  readonly version: number;
  readonly changeSummary: string | null;
  readonly modelKey: string | null;
  readonly createdAt: string;
}

/**
 * Version history (spec §33).
 *
 * Restoring appends a new version rather than moving a pointer, so the restore
 * itself is undoable. The UI says so, because "restore" that silently discards
 * newer work is the behaviour users fear.
 */
export function VersionHistory({
  artifactId,
  currentVersion,
  versions,
}: {
  artifactId: string;
  currentVersion: number;
  versions: readonly VersionSummary[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <h2 className="flex items-center gap-2 text-sm font-medium text-text">
        <History className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
        Version history
      </h2>
      <p className="mt-1 text-sm text-text-secondary">
        Every change adds a version. Restoring creates a new one, so nothing is ever lost.
      </p>

      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {versions.map((version) => {
          const isCurrent = version.version === currentVersion;
          return (
            <li
              key={version.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                isCurrent ? 'bg-accent-subtle' : 'bg-surface/40'
              }`}
            >
              <span className="w-10 shrink-0 font-mono text-xs text-text-muted">
                v{version.version}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">
                  {version.changeSummary ?? 'Updated'}
                </span>
                <span className="block text-[11px] text-text-muted">
                  {new Date(version.createdAt).toLocaleString()}
                  {version.modelKey ? ` · ${version.modelKey}` : ''}
                </span>
              </span>

              {isCurrent ? (
                <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-accent">
                  Current
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(() => void restoreVersionAction(artifactId, version.version))
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-strong px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text disabled:opacity-40"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={2} />
                  Restore
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
