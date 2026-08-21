'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { createPlan } from '@/app/(admin)/admin/actions';

/**
 * Creating a plan.
 *
 * Three fields, because a new plan starts unsold and unlisted — its limits have
 * not been reviewed yet, and asking for all of them up front would mean filling
 * a dozen boxes before finding out whether the key was even free.
 */
export function NewPlan() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [state, setState] = useState<{ error?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs text-text-secondary transition-colors hover:text-text"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        New plan
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createPlan({ key, name, priceMonthlyUsd: price });
          setState(result);
          if (!result.error) {
            setKey('');
            setName('');
            setPrice('0');
            setOpen(false);
          }
        });
      }}
      className="rounded-xl border border-border-strong bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-text-secondary">
          Key
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="scale"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-text"
          />
          <span className="mt-1 block text-[0.6875rem] text-text-muted">
            Permanent. Subscriptions reference it.
          </span>
        </label>

        <label className="text-xs text-text-secondary">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Scale"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text"
          />
        </label>

        <label className="text-xs text-text-secondary">
          Price per month (USD)
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm tabular-nums text-text"
          />
        </label>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-on-accent disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create plan'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
