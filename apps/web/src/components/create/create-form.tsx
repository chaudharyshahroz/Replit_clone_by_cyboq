'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { FileText, Image as ImageIcon, Loader2, Presentation, Video } from 'lucide-react';
import { createAction, type CreateFormState } from '@/app/(app)/create/actions';

interface Availability {
  readonly kind: string;
  readonly available: boolean;
  readonly detail: string;
}

const KINDS = [
  { kind: 'document', label: 'Document', icon: FileText, placeholder: 'A one-page brief on our Q3 pricing change, for the sales team' },
  { kind: 'presentation', label: 'Slides', icon: Presentation, placeholder: 'A 10-slide investor update covering growth, churn and runway' },
  { kind: 'image', label: 'Image', icon: ImageIcon, placeholder: 'A wide hero image of a quiet workshop at dawn, warm light' },
  { kind: 'video', label: 'Video', icon: Video, placeholder: '' },
] as const;

/**
 * Create something.
 *
 * An unavailable kind stays visible and states why, rather than disappearing:
 * a missing option looks like a product that cannot do the thing, where a
 * disabled one with a reason is a deployment that has not been configured yet
 * (spec §25).
 */
export function CreateForm({
  availability,
  initialPrompt,
  initialKind,
}: {
  availability: readonly Availability[];
  /** Carried from the chat composer's Image tool. */
  initialPrompt?: string;
  initialKind?: string;
}) {
  const [state, action, pending] = useActionState<CreateFormState, FormData>(createAction, {});
  /*
   * A failed submission's own kind wins over the incoming link: after an error
   * the form should show what the person actually tried, not reset to whatever
   * they arrived with.
   */
  const [kind, setKind] = useState<string>(
    state.submitted?.kind ?? initialKind ?? 'document',
  );

  const byKind = new Map(availability.map((entry) => [entry.kind, entry]));
  const selected = KINDS.find((entry) => entry.kind === kind)!;
  const status = byKind.get(kind);
  const usable = status?.available ?? false;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((entry) => {
          const Icon = entry.icon;
          const entryStatus = byKind.get(entry.kind);
          const active = entry.kind === kind;
          return (
            <button
              key={entry.kind}
              type="button"
              onClick={() => setKind(entry.kind)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-accent-border bg-accent-subtle text-accent'
                  : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
              } ${entryStatus?.available === false ? 'opacity-60' : ''}`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {entry.label}
            </button>
          );
        })}
      </div>

      {/* The reason, always — not only when something fails. */}
      {status && !status.available ? (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {status.detail}
        </p>
      ) : null}

      <form action={action} className="mt-4">
        <input type="hidden" name="kind" value={kind} />

        <textarea
          name="prompt"
          rows={4}
          required
          minLength={8}
          disabled={!usable}
          defaultValue={state.submitted?.prompt ?? initialPrompt}
          placeholder={selected.placeholder || 'Not available on this instance.'}
          className="w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-3 text-sm leading-relaxed text-text outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-50"
        />

        {state.error ? (
          <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
            {state.error}
          </p>
        ) : null}

        {state.result ? (
          <div role="status" className="mt-3 rounded-lg border border-border bg-surface px-3.5 py-3">
            <p className="text-sm text-text">{state.result.title}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {state.result.kind} · {state.result.detail}
            </p>
            <Link
              href={`/artifacts/${state.result.artifactId}`}
              className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
            >
              Open it
            </Link>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending || !usable}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
          {pending ? 'Creating…' : `Create ${selected.label.toLowerCase()}`}
        </button>

        {pending && kind === 'image' ? (
          <p className="mt-2 text-xs text-text-muted">
            Image generation takes up to a minute.
          </p>
        ) : null}
      </form>
    </div>
  );
}
