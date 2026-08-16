'use client';

import { useTransition } from 'react';
import { FileText, FolderPlus, Presentation } from 'lucide-react';
import {
  convertToDocumentAction,
  convertToPresentationAction,
  convertToProjectAction,
} from './actions';

/**
 * Spec §26 — research must lead to execution.
 *
 * Each conversion preserves provenance: the derived artifact links back to the
 * research that produced it.
 */
export function ConvertActions({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();

  const actions = [
    { label: 'Create document', icon: FileText, run: convertToDocumentAction },
    { label: 'Create presentation', icon: Presentation, run: convertToPresentationAction },
    { label: 'Start a project', icon: FolderPlus, run: convertToProjectAction },
  ] as const;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map(({ label, icon: Icon, run }) => (
        <button
          key={label}
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void run(sessionId))}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
