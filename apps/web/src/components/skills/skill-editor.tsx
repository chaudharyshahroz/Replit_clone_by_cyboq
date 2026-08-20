'use client';

import { useActionState, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { createSkillAction, type SkillFormState } from '@/app/(app)/skills/actions';

const CATEGORIES = [
  'development', 'design', 'research', 'marketing', 'sales',
  'productivity', 'data', 'finance', 'writing', 'other',
] as const;

/**
 * Author a skill.
 *
 * The handle is not editable here: it is derived from the name and
 * de-duplicated server-side against both workspace skills and built-ins, so
 * offering a field that can silently be changed on submit would be a lie.
 * The created handle is shown afterwards.
 */
export function SkillEditor() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SkillFormState, FormData>(
    createSkillAction,
    {},
  );

  if (state.handle && open) {
    // Created. Show the invocation handle, which is the thing the user needs.
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        <p className="text-sm text-text">Skill created.</p>
        <p className="mt-1.5 text-sm text-text-secondary">
          Invoke it in Chat by typing{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-accent">@{state.handle}</code>
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface-hover"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        New skill
      </button>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-border bg-surface/40 p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-medium text-text">New skill</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded p-1 text-text-muted hover:text-text"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        <Field label="Name" hint="Also becomes the @handle used to invoke it.">
          <input
            name="name"
            required
            minLength={3}
            placeholder="Research Analyst"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </Field>

        <Field label="Description" hint="What it does, in one line.">
          <input
            name="description"
            required
            minLength={10}
            placeholder="Turns raw notes into a sourced summary"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </Field>

        <Field label="Category">
          <select
            name="category"
            defaultValue="other"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category[0]!.toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Instructions"
          hint="How the model should respond when this skill is invoked."
        >
          <textarea
            name="instructions"
            required
            minLength={20}
            rows={7}
            placeholder={'Answer in three bullet points.\nCite a source for each.\nAvoid jargon.'}
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </Field>

        <Field label="Reference material" hint="Optional. Facts the skill should always have.">
          <textarea
            name="knowledge"
            rows={4}
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-accent"
          />
        </Field>
      </div>

      {/*
        Stated at authoring time, not discovered later: a skill guides the
        response, it does not change what the model is allowed to do.
      */}
      <p className="mt-4 text-[0.6875rem] leading-relaxed text-text-muted">
        Instructions are applied as part of your request. A skill cannot grant
        itself permissions or override Reklu&rsquo;s guidelines.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
        {pending ? 'Creating…' : 'Create skill'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text">{label}</span>
      {hint ? <span className="ml-2 text-[0.6875rem] text-text-muted">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
