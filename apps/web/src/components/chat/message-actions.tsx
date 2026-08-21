'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { rateMessageAction } from '@/app/(app)/chat/actions';

/**
 * What you can do with a reply once it has arrived.
 *
 * Every control here does something. There is no share button: a link to this
 * conversation only opens for the person who owns it, so "share" would copy an
 * address that shows the recipient a sign-in page. That is worse than not
 * offering it (spec §137) — public sharing is a real feature and needs to be
 * built as one.
 */
export function MessageActions({
  text,
  messageId,
  initialFeedback,
  onRegenerate,
}: {
  readonly text: string;
  /** Absent while streaming, or for a turn that was never persisted. */
  readonly messageId?: string | undefined;
  readonly initialFeedback?: 'up' | 'down' | undefined;
  /** Only supplied for the most recent reply — the only one that can be redone. */
  readonly onRegenerate?: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [error, setError] = useState<string | undefined>();
  const [, startTransition] = useTransition();

  // The tick is a confirmation, not a state — it goes back on its own.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Denied clipboard permission, or an insecure origin.
      setError('Could not copy. Your browser blocked clipboard access.');
    }
  };

  const rate = (next: 'up' | 'down'): void => {
    if (!messageId) return;

    // Pressing the rating already set clears it, so an opinion can be withdrawn.
    const value = feedback === next ? null : next;
    setFeedback(value ?? undefined);

    startTransition(async () => {
      const result = await rateMessageAction(messageId, value);
      if (result.error) {
        setError(result.error);
        setFeedback(feedback);
      }
    });
  };

  const button =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text';

  return (
    <div className="mt-2">
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
        <button type="button" onClick={() => void copy()} aria-label="Copy reply" className={button}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>

        {messageId ? (
          <>
            <button
              type="button"
              onClick={() => rate('up')}
              aria-label="Good response"
              aria-pressed={feedback === 'up'}
              className={`${button} ${feedback === 'up' ? 'text-accent' : ''}`}
            >
              <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>

            <button
              type="button"
              onClick={() => rate('down')}
              aria-label="Bad response"
              aria-pressed={feedback === 'down'}
              className={`${button} ${feedback === 'down' ? 'text-accent' : ''}`}
            >
              <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </>
        ) : null}

        {onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            aria-label="Try again"
            className={button}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-[0.6875rem] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
