'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play } from 'lucide-react';
import { startRunAction, type AgentFormState } from '@/app/(app)/agents/actions';

export function StartRunForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<AgentFormState, FormData>(startRunAction, {});

  if (state.runId) {
    router.push(`/agents/${state.runId}`);
  }

  return (
    <form action={action} className="rounded-xl border border-border bg-surface/40 p-5">
      <label className="block">
        <span className="text-xs font-medium text-text">Objective</span>
        <textarea
          name="objective"
          rows={3}
          required
          minLength={10}
          defaultValue={state.submitted?.objective}
          placeholder="Research the three biggest competitors and summarise how they price"
          className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-3.5 py-3 text-sm leading-relaxed text-text outline-none placeholder:text-text-muted focus:border-accent"
        />
      </label>

      <label className="mt-4 block max-w-[12rem]">
        <span className="text-xs font-medium text-text">Step limit</span>
        <input
          name="maxSteps"
          type="number"
          min={1}
          max={100}
          defaultValue={10}
          className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
      </label>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <Play className="h-4 w-4" strokeWidth={2} />
        )}
        {pending ? 'Planning…' : 'Plan the work'}
      </button>

      <p className="mt-2 text-[11px] text-text-muted">
        Reklu plans first and shows you the steps. Nothing runs until you start it.
      </p>
    </form>
  );
}
