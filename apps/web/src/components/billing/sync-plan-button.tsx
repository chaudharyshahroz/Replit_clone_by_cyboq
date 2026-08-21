'use client';

import { useState, useTransition } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { reconcileBillingAction } from '@/app/(app)/settings/billing/actions';

/**
 * Ask Whop again.
 *
 * Exists because the honest answer to "I paid and it still says Free" cannot be
 * "wait". A webhook that never arrives never arrives, and this is the button
 * that goes and looks — the same check that runs automatically on return from
 * checkout, put somewhere a customer can reach it.
 */
export function SyncPlanButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await reconcileBillingAction();
            setMessage(result.message);
          })
        }
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong px-3 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {pending ? 'Checking with Whop' : 'Check for a recent purchase'}
      </button>

      {message ? (
        <p role="status" className="text-xs text-text-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
