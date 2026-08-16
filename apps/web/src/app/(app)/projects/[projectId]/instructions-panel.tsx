'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { updateInstructionsAction } from '../actions';

export function InstructionsPanel({
  projectId,
  instructions,
}: {
  projectId: string;
  instructions: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-text">Project instructions</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Applied to every request in this project.
          </p>
        </div>
        {!editing ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {instructions ? 'Edit' : 'Add'}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          action={(formData) => {
            startTransition(async () => {
              await updateInstructionsAction(projectId, formData);
              setEditing(false);
            });
          }}
          className="mt-4"
        >
          <label htmlFor="instructions" className="sr-only">
            Project instructions
          </label>
          <textarea
            id="instructions"
            name="instructions"
            rows={6}
            defaultValue={instructions}
            placeholder="Standing instructions Reklu should follow in this project…"
            className="w-full resize-y rounded-xl border border-border-strong bg-surface px-4 py-3 text-sm leading-relaxed text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : instructions ? (
        <p className="mt-4 whitespace-pre-wrap rounded-xl border border-border bg-surface/40 p-4 text-sm leading-relaxed text-text-secondary">
          {instructions}
        </p>
      ) : (
        <p className="mt-4 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
          No instructions yet. Add them so you never have to re-explain this project.
        </p>
      )}
    </div>
  );
}
