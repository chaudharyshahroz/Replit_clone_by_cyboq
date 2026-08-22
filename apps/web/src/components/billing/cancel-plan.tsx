'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { cancelPlanAction, resumePlanAction } from '@/app/(app)/settings/billing/actions';

/**
 * Cancelling, where the buying happened.
 *
 * Sending someone to another company's site to stop paying is a dark pattern by
 * omission — the exit should not be harder to find than the entrance. Whop
 * still holds the card; the decision is made here.
 *
 * Cancelling asks first. It is not destructive — nothing is deleted and the
 * period already paid for is kept — but it is a money decision that is annoying
 * to undo by hand, so it does not happen on a single stray click.
 */
export function CancelPlan({
  canManage,
  endsAt,
  scheduledToEnd,
}: {
  readonly canManage: boolean;
  readonly endsAt: string | null;
  readonly scheduledToEnd: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  /*
   * Said plainly rather than hidden. Someone who cannot do this should learn
   * why from the page, not from a button that does nothing.
   */
  if (!canManage) {
    return (
      <p className="text-xs text-text-muted">
        Only a workspace owner or admin can change or cancel the plan.
      </p>
    );
  }

  const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const result = await action();
      setMessage(result.message);
      setFailed(!result.ok);
      if (result.ok) setConfirming(false);
    });

  if (scheduledToEnd) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(resumePlanAction)}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong px-3 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
          Keep my plan
        </button>
        {message ? (
          <p role="status" className={`text-xs ${failed ? 'text-danger' : 'text-text-muted'}`}>
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
        >
          Cancel plan
        </button>
        {message ? (
          <p role="status" className={`text-xs ${failed ? 'text-danger' : 'text-text-muted'}`}>
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-strong bg-surface-raised p-4">
      <p className="text-sm text-text">Cancel your plan?</p>
      {/*
        What actually happens, in full. "Are you sure?" tells someone nothing
        they did not already know; the part worth saying is that they keep what
        they paid for.
      */}
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
        You keep everything until{' '}
        {endsAt ? (
          <span className="text-text">{endsAt}</span>
        ) : (
          'the end of the period you have paid for'
        )}
        , then the workspace moves to the Free plan. Nothing is deleted, and you can
        start again at any time.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(cancelPlanAction)}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 text-xs text-danger transition-colors hover:bg-danger/20 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
          {pending ? 'Cancelling' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setMessage(null);
          }}
          className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
        >
          Keep my plan
        </button>
      </div>

      {message ? (
        <p role="alert" className={`mt-3 text-xs ${failed ? 'text-danger' : 'text-text-muted'}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
