'use client';

import { useState, useTransition } from 'react';
import { Brain, Check, Plus, X } from 'lucide-react';
import type { ProjectMemory } from '@reklu/database';
import { Button } from '@/components/ui/button';
import { addMemoryAction, approveMemoryAction, forgetMemoryAction } from '../actions';

/**
 * Memory inspection (spec §18: users must be able to inspect and remove
 * project memory).
 *
 * Unapproved inferences are shown separately and prominently. They are what
 * Reklu *thinks* it learned but has not been allowed to act on — the user
 * decides whether that becomes a durable belief.
 */
const KIND_LABEL: Record<string, string> = {
  fact: 'Fact',
  preference: 'Preference',
  decision: 'Decision',
  summary: 'Summary',
  instruction: 'Instruction',
};

const SOURCE_LABEL: Record<string, string> = {
  user: 'You told Reklu',
  inferred: 'Reklu inferred',
  system: 'Summarized automatically',
};

export function MemoryPanel({
  projectId,
  memories,
}: {
  projectId: string;
  memories: readonly ProjectMemory[];
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const approved = memories.filter((m) => m.approvedAt !== null);
  const awaiting = memories.filter((m) => m.approvedAt === null);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-text">Memory</h2>
          <p className="mt-1 text-sm text-text-secondary">
            What Reklu remembers about this project. Everything here is inspectable and
            removable.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add
        </Button>
      </div>

      {adding ? (
        <form
          action={(formData) => {
            startTransition(async () => {
              await addMemoryAction(projectId, formData);
              setAdding(false);
            });
          }}
          className="mt-4 rounded-xl border border-border-strong bg-surface p-4"
        >
          <label htmlFor="memory-content" className="block text-sm font-medium text-text">
            Something Reklu should remember
          </label>
          <textarea
            id="memory-content"
            name="content"
            rows={2}
            required
            placeholder="The launch deadline is 14 November."
            className="mt-2 w-full resize-none rounded-lg border border-border-strong bg-canvas px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="memory-kind" className="sr-only">
              Kind
            </label>
            <select
              id="memory-kind"
              name="kind"
              defaultValue="fact"
              className="h-8 rounded-md border border-border-strong bg-canvas px-2 text-xs text-text"
            >
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="decision">Decision</option>
            </select>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Remember'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {/* Awaiting review — Reklu's own inferences, not yet trusted. */}
      {awaiting.length > 0 ? (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h3 className="text-sm font-medium text-text">
            {awaiting.length} {awaiting.length === 1 ? 'memory' : 'memories'} to review
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Reklu inferred these rather than being told. They are excluded from every request
            until you approve them.
          </p>
          <ul className="mt-3 space-y-2">
            {awaiting.map((memory) => (
              <li
                key={memory.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-canvas p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text">{memory.content}</span>
                  <span className="mt-1 block text-[11px] text-text-muted">
                    {KIND_LABEL[memory.kind]} · {SOURCE_LABEL[memory.source]}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Approve"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => void approveMemoryAction(projectId, memory.id))
                    }
                    className="rounded-md border border-border-strong p-1.5 text-success transition-colors hover:bg-surface-hover disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    aria-label="Discard"
                    disabled={pending}
                    onClick={() =>
                      startTransition(() => void forgetMemoryAction(projectId, memory.id))
                    }
                    className="rounded-md border border-border-strong p-1.5 text-text-muted transition-colors hover:text-danger disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {approved.length === 0 ? (
        <p className="mt-4 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
          Nothing remembered yet. As you work, Reklu records facts, decisions and preferences
          here — each one showing where it came from.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {approved.map((memory) => (
            <li key={memory.id} className="flex items-start gap-3 bg-surface/40 px-4 py-3">
              <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text">{memory.content}</span>
                <span className="mt-1 block text-[11px] text-text-muted">
                  {KIND_LABEL[memory.kind]} · {SOURCE_LABEL[memory.source]}
                  {memory.sourceMessageId ? ' · from a chat message' : ''}
                  {memory.sourceFileId ? ' · from a file' : ''}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Forget: ${memory.content.slice(0, 40)}`}
                disabled={pending}
                onClick={() => startTransition(() => void forgetMemoryAction(projectId, memory.id))}
                className="shrink-0 rounded text-text-muted transition-colors hover:text-danger disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
