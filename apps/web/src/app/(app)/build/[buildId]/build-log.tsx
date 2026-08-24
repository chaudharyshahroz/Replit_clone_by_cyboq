'use client';

import { Check, FileCode2, Loader2 } from 'lucide-react';
import type { BuildStep } from '../actions';

/**
 * What the build is doing, as it does it.
 *
 * A build takes minutes, and this panel used to be a button with a spinner on
 * it — which says something is happening and nothing about what. Every line
 * here is written by the build itself at the moment it reaches that step: the
 * stages it enters, and each file named as it starts being written. Nothing is
 * on a timer and nothing is invented; if the list stops moving, the build has
 * stopped moving.
 */
export function BuildLog({
  steps,
  running,
}: {
  readonly steps: readonly BuildStep[];
  /** True while the build is still going, so the last line can show as active. */
  readonly running: boolean;
}) {
  if (steps.length === 0) return null;

  return (
    /*
      Files are set smaller and tighter than the prose deliberately. What the
      build is doing is the thing worth reading; which file it reached is
      supporting detail, and giving both the same weight turned the panel into a
      wall of filenames with the explanation lost inside it.
    */
    <ol className="mt-4 space-y-1">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const active = running && last;

        /*
          The model's own prose reads as a paragraph, not as a row in a list.
          Giving it a tick and a monospace column would file an explanation
          under the same heading as `tailwind.config.ts`, which is not what it
          is.
        */
        if (step.kind === 'say') {
          return (
            <li key={step.id} className="py-1.5">
              <p className="text-sm leading-relaxed text-text">{step.message}</p>
            </li>
          );
        }

        return (
          <li
            key={step.id}
            className={`flex items-start gap-2.5 text-sm ${step.kind === 'file' ? 'py-0' : ''}`}
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {active ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-accent motion-reduce:animate-none"
                  strokeWidth={2.25}
                />
              ) : step.kind === 'file' ? (
                <FileCode2 className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.75} />
              ) : (
                <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />
              )}
            </span>

            <span
              className={`min-w-0 flex-1 leading-relaxed ${
                step.kind === 'file'
                  ? 'truncate font-mono text-[0.6875rem] text-text-muted'
                  : active
                    ? 'text-text'
                    : 'text-text-secondary'
              }`}
            >
              {step.message}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
