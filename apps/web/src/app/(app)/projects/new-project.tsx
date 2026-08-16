'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { createProjectAction, type ProjectFormState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" disabled={pending}>
      {pending ? 'Creating…' : 'Create project'}
    </Button>
  );
}

export function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ProjectFormState, FormData>(createProjectAction, {});
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" strokeWidth={2} />
        New project
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="w-full max-w-md rounded-xl border border-border-strong bg-surface p-6 shadow-2xl shadow-black/50"
      >
        <h2 id="new-project-title" className="text-base font-medium text-text">
          New project
        </h2>
        <p className="mt-1.5 text-sm text-text-secondary">
          Everything you do inside a project shares its context.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          {state.error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
              {state.error}
            </p>
          ) : null}

          <Field
            ref={firstFieldRef}
            label="Name"
            name="name"
            required
            placeholder="AI fitness company"
            errors={state.fieldErrors?.name}
          />
          <Field
            label="Description"
            name="description"
            placeholder="Optional — what is this project for?"
          />

          <div className="space-y-1.5">
            <label htmlFor="instructions" className="block text-sm font-medium text-text">
              Project instructions
            </label>
            <textarea
              id="instructions"
              name="instructions"
              rows={4}
              placeholder="Standing instructions Reklu should follow in this project…"
              className="w-full resize-none rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
            <p className="text-xs text-text-muted">
              Applied to every request in this project. You can change it later.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit />
          </div>
        </form>
      </div>
    </div>
  );
}
