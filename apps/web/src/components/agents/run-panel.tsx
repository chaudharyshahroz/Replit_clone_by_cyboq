'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CircleDot, Loader2, Play, X } from 'lucide-react';
import {
  advanceRunAction,
  cancelRunAction,
  decideApprovalAction,
  type AgentFormState,
} from '@/app/(app)/agents/actions';

interface Run {
  readonly id: string;
  readonly status: string;
  readonly stepsExecuted: number;
  readonly totalSteps: number;
  readonly errorMessage: string | null;
}

interface Step {
  readonly id: string;
  readonly stepIndex: number;
  readonly title: string;
  readonly description: string | null;
  readonly kind: string;
  readonly toolName: string | null;
  readonly status: string;
  readonly output: string | null;
  readonly errorMessage: string | null;
}

interface Approval {
  readonly id: string;
  readonly action: string;
  readonly reason: string;
  readonly riskClass: string;
  readonly payload: string;
  readonly expiresAt: string | null;
}

const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Drive a run forward, one step per click.
 *
 * The loop lives here rather than in the server action deliberately: a run
 * blocked on approval stops rather than spinning, and a runaway cannot hide
 * inside a single long request.
 */
export function RunPanel({
  run,
  steps,
  approval,
}: {
  run: Run;
  steps: readonly Step[];
  approval: Approval | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const act = (fn: () => Promise<AgentFormState>): void => {
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      setNotice(result.error ?? result.detail ?? null);
      router.refresh();
    });
  };

  const finished = FINISHED.has(run.status);

  return (
    <div className="mt-8 space-y-6">
      {notice ? (
        <p role="status" className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
          {notice}
        </p>
      ) : null}

      {run.errorMessage ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {run.errorMessage}
        </p>
      ) : null}

      {/* ---- The approval gate ------------------------------------------
        Shown above the steps, because until it is answered nothing else can
        happen. The exact payload is displayed: the person approves this, and
        the runner refuses to execute anything that differs from it.
      */}
      {approval ? (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={2} />
            This step needs your approval
          </h2>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text">
            {approval.action}
          </p>
          <p className="mt-1.5 text-xs text-text-secondary">{approval.reason}</p>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-text-muted">
              Exactly what will run
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {approval.payload}
            </pre>
          </details>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => decideApprovalAction(approval.id, true))}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => decideApprovalAction(approval.id, false))}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface-hover disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Deny
            </button>
          </div>

          {approval.expiresAt ? (
            <p className="mt-2 text-[11px] text-text-muted">
              Expires {new Date(approval.expiresAt).toLocaleString()} — an unanswered
              approval does not block the run forever.
            </p>
          ) : null}
        </section>
      ) : null}

      {!finished && !approval ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => advanceRunAction(run.id))}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={2} />
            )}
            {pending ? 'Running…' : 'Run next step'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => cancelRunAction(run.id))}
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-text-secondary hover:bg-surface-hover disabled:opacity-60"
          >
            Cancel run
          </button>
        </div>
      ) : null}

      <section>
        <h2 className="text-sm font-medium text-text">Plan</h2>
        <ol className="mt-3 space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="rounded-lg border border-border bg-surface p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <StepIcon status={step.status} />
                <span className="text-sm text-text">{step.title}</span>
                <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                  {step.toolName ?? step.kind}
                </span>
              </div>

              {step.description ? (
                <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                  {step.description}
                </p>
              ) : null}

              {step.output ? (
                <p className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-xs leading-relaxed text-text-secondary">
                  {step.output.slice(0, 1_200)}
                </p>
              ) : null}

              {step.errorMessage ? (
                <p className="mt-2 text-xs leading-relaxed text-warning">{step.errorMessage}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'succeeded') {
    return <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} />;
  }
  if (status === 'failed') {
    return <X className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2.5} />;
  }
  if (status === 'running') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />;
  }
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />;
}
