'use client';

import { useState, useTransition } from 'react';
import { ArrowUp, ChevronDown, Loader2 } from 'lucide-react';
import type { BuildBrief } from '@reklu/build';
import { generateBuildAction } from '../actions';

/**
 * The Build Brief (spec §29).
 *
 * Shown, not asked as a questionnaire — Reklu infers sensible defaults and the
 * user corrects them. It is visible before generation so the interpretation can
 * be checked, which is the point: a wrong brief produces a wrong application.
 */
export function BriefPanel({
  brief,
  buildId,
  hasFiles,
}: {
  brief: BuildBrief;
  buildId: string;
  /** False before the first generation, when there is nothing to change yet. */
  hasFiles: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const generate = (instruction: string) =>
    startTransition(async () => {
      setOutcome(null);
      const result = await generateBuildAction(buildId, instruction);
      setOutcome({ ok: result.ok, message: result.message });
      if (result.ok) setPrompt('');
    });

  const sections: readonly { label: string; values: readonly string[] }[] = [
    { label: 'Users', values: brief.userRoles ?? [] },
    { label: 'Features', values: brief.coreFeatures ?? [] },
    { label: 'Pages', values: (brief.pages ?? []).map((p) => `${p.name} — ${p.purpose}`) },
    {
      label: 'Data',
      values: (brief.dataModel ?? []).map((e) => `${e.entity}(${e.fields.join(', ')})`),
    },
    { label: 'Stack', values: brief.stack ?? [] },
    { label: 'Out of scope', values: brief.outOfScope ?? [] },
  ];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded text-left"
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? '' : '-rotate-90'}`}
          strokeWidth={2}
        />
        <span className="text-sm font-medium text-text">Build brief</span>
        <span className="text-xs text-text-muted">
          {brief.target?.replace(/_/g, ' ')}
          {brief.platforms && brief.platforms.length > 0
            ? ` · ${brief.platforms.join(', ')}`
            : ''}
        </span>
      </button>

      {open ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-text-secondary">{brief.summary}</p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {sections
              .filter((section) => section.values.length > 0)
              .map((section) => (
                <div key={section.label}>
                  <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
                    {section.label}
                  </dt>
                  <dd className="mt-1 space-y-0.5">
                    {section.values.map((value) => (
                      <p key={value} className="text-xs text-text-secondary">
                        {value}
                      </p>
                    ))}
                  </dd>
                </div>
              ))}
          </dl>

          {(brief.needsAuth || brief.needsDatabase) ? (
            <p className="mt-3 text-[0.6875rem] text-text-muted">
              {brief.needsAuth ? 'Includes authentication. ' : ''}
              {brief.needsDatabase ? 'Includes a database.' : ''}
            </p>
          ) : null}

          {/*
            The first generation needs no further instruction.
            
            This screen used to offer only a text box whose placeholder said
            "Build it" above a button disabled until something was typed — so
            the one obvious next step was the one thing that could not be done.
            The brief already says what to build; asking the person to describe
            it a second time is asking them to repeat themselves to a form.
          */}
          {!hasFiles ? (
            <div className="mt-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => generate('Build it, exactly as described in the brief.')}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
                ) : null}
                {pending ? 'Generating the app' : 'Generate this app'}
              </button>
              <p className="mt-2 text-xs text-text-muted">
                Or change the brief first by describing what is wrong with it below.
              </p>
            </div>
          ) : null}

          {/*
            Said out loud. Generation used to report nothing at all — a failed
            provider call, a model that returned no files and a success all
            looked the same from here, which is why the button read as dead.
          */}
          {outcome ? (
            <p
              role={outcome.ok ? 'status' : 'alert'}
              className={`mt-3 rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                outcome.ok
                  ? 'border-success/40 bg-success/10 text-text'
                  : 'border-danger/40 bg-danger/10 text-text'
              }`}
            >
              {outcome.message}
            </p>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const text = prompt.trim();
              if (!text) return;
              generate(text);
            }}
            className="mt-4 flex items-end gap-2 rounded-lg border border-border-strong bg-surface p-2"
          >
            <label htmlFor="build-instruction" className="sr-only">
              What should Reklu build or change?
            </label>
            <textarea
              id="build-instruction"
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                hasFiles
                  ? "Describe a change, e.g. 'add a settings screen'"
                  : "Or correct the brief, e.g. 'it should also take online orders'"
              }
              className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-text placeholder:text-text-muted focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending || !prompt.trim()}
              aria-label="Generate"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
              )}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
