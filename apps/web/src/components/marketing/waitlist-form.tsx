'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { joinWaitlistAction } from '@/app/waitlist-actions';
import type { JoinResult } from '@/lib/waitlist';

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <ArrowRight className="h-4 w-4" strokeWidth={2} />
      )}
      {pending ? 'Joining…' : 'Join the waitlist'}
    </button>
  );
}

/** Where somebody asks to be told when Reklu opens. */
export function WaitlistForm({ source }: { source?: string }) {
  const [result, action] = useActionState<JoinResult | null, FormData>(joinWaitlistAction, null);

  if (result?.ok) {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3.5 text-left"
      >
        <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={2.5} />
        <p className="text-sm leading-relaxed text-text">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="source" value={source ?? ''} />

        {/*
          A field no person can see, and no person fills in. Hidden from
          assistive technology as well as from sight — describing it to somebody
          using a screen reader would put the trap in front of exactly the
          people it must not catch.
        */}
        <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
          <label htmlFor="company">Company</label>
          <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label htmlFor="waitlist-email" className="sr-only">
          Your email address
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className="h-12 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 text-sm text-text placeholder:text-text-muted focus:border-accent-border focus:outline-none"
        />
        <Submit />
      </form>

      {result && !result.ok ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {result.message}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-text-muted">
        One email when Reklu opens. Nothing else, and no sharing with anyone.
      </p>
    </div>
  );
}
