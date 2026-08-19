'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, ArrowUp } from 'lucide-react';
import { createBuildAction, type BuildFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Start build"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
    >
      <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
    </button>
  );
}

export function NewBuildForm({ initialPrompt }: { initialPrompt?: string }) {
  const [state, formAction] = useActionState<BuildFormState, FormData>(createBuildAction, {});

  return (
    <form action={formAction}>
      {state.error ? (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
          {state.error}
        </p>
      ) : null}

      <div className="rounded-xl border border-border-strong bg-surface">
        <label htmlFor="build-prompt" className="sr-only">
          What do you want built?
        </label>
        <textarea
          id="build-prompt"
          name="prompt"
          rows={3}
          required
          /* Carried from the chat composer's Build tool. */
          defaultValue={initialPrompt}
          placeholder="An AI calorie tracking mobile app with meal logging, progress charts and subscriptions…"
          className="w-full resize-none bg-transparent px-4 pt-4 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <p className="text-[11px] text-text-muted">
            Reklu writes a brief first, so it builds the product — not just the example.
          </p>
          <Submit />
        </div>
      </div>
    </form>
  );
}
