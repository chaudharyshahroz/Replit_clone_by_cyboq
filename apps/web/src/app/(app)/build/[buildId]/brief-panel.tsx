'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowUp, ChevronDown, Loader2, Paperclip, Sparkles, X } from 'lucide-react';
import type { BuildBrief } from '@reklu/build';
import { generateBuildAction, type BuildStep } from '../actions';
import { fetchBuildProgress } from '@/lib/build-progress';
import { clearPreviewEdits, hasPreviewEdits, usePreviewEdits } from '@/lib/preview-selection';
import type { SelectableModel, UploadedFile } from '@/components/chat/chat-view';
import { BuildLog } from './build-log';

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
  status,
  models,
  initialModelKey,
}: {
  brief: BuildBrief;
  buildId: string;
  /** What this workspace's plan may use, for the composer's model picker. */
  models: readonly SelectableModel[];
  /** False before the first generation, when there is nothing to change yet. */
  hasFiles: boolean;
  /** The project's stored status, which says whether a build has been tried. */
  status: string;
  /** Model selected before the user entered the build workspace, if any. */
  initialModelKey?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [steps, setSteps] = useState<readonly BuildStep[]>([]);
  const [attachments, setAttachments] = useState<readonly UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modelKey, setModelKey] = useState(initialModelKey ?? 'auto');
  const fileInput = useRef<HTMLInputElement>(null);

  /*
   * Picked in the preview, typed against here. The chip is the whole point of
   * the arrow: it makes "make this bigger" a sentence with a subject, and it
   * shows what that subject is before the request goes anywhere.
   */
  const edits = usePreviewEdits();
  const picked = hasPreviewEdits(edits);

  const generate = (instruction: string, origin: 'user' | 'auto' = 'user') => {
    const sent = {
      instruction,
      origin,
      ...(edits.selection ? { selection: edits.selection } : {}),
      ...(edits.annotation ? { annotation: edits.annotation } : {}),
      ...(edits.textChanges.length ? { textChanges: edits.textChanges } : {}),
      ...(attachments.length ? { fileIds: attachments.map((file) => file.id) } : {}),
      ...(modelKey === 'auto' ? {} : { modelKey }),
    };

    /*
     * Emptied here, outside the transition, and that placement is the whole
     * point.
     *
     * React holds the updates inside an async transition until the transition
     * settles, so that nobody sees a half-applied state. Clearing the box in
     * there meant it stayed full for the entire build — the instruction sat in
     * the composer, word for word, beside its own copy in the transcript, and
     * looked unsent for two minutes. Outside, it is an ordinary update and
     * commits at once.
     *
     * The selection and the files go with it: all three belong to the turn that
     * was just sent, not to the next one.
     */
    if (origin === 'user') {
      setPrompt('');
      setAttachments([]);
      clearPreviewEdits();
    }

    startTransition(async () => {
      setOutcome(null);
      const result = await generateBuildAction(buildId, sent);
      setStage(null);
      setOutcome({ ok: result.ok, message: result.message });
    });
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    for (const file of Array.from(list)) {
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await fetch('/api/files/upload', { method: 'POST', body: form });
        const payload = (await response.json()) as
          | { file: UploadedFile }
          | { error: { message: string } };
        if (!response.ok || !('file' in payload)) {
          /* Named, not swallowed: an upload that failed silently looks attached. */
          setOutcome({
            ok: false,
            message: 'error' in payload ? payload.error.message : `Could not attach ${file.name}.`,
          });
          continue;
        }
        setAttachments((current) => [...current, payload.file]);
      } catch {
        setOutcome({ ok: false, message: `Could not attach ${file.name}.` });
      }
    }
    setUploading(false);
  };

  /*
   * Start on arrival. Asking for an application and then being shown a button
   * that says "generate this app" is asking the same question twice — the brief
   * on this screen is the answer to the first one.
   *
   * Only from `briefing`, and only once per mount. A build that already failed
   * must not retry itself every time the page is opened: that is a loop nobody
   * asked for, spending model credits on the same failure.
   */
  const autoStarted = useRef(false);

  useEffect(() => {
    if (autoStarted.current || hasFiles || pending) return;
    if (status !== 'briefing') return;
    autoStarted.current = true;
    generate('Build it, exactly as described in the brief.', 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFiles, status]);

  /* Whatever the build already did, so the log survives a reload. */
  useEffect(() => {
    let cancelled = false;
    void fetchBuildProgress(buildId).then((progress) => {
      if (!cancelled && progress) setSteps(progress.steps);
    });
    return () => {
      cancelled = true;
    };
  }, [buildId]);

  /*
   * Real stages, read back from the build itself as it enters them. Nothing
   * here is invented: each phrase is written by the generator at the moment it
   * starts that step.
   */
  useEffect(() => {
    if (!pending) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const progress = await fetchBuildProgress(buildId);
        if (cancelled || !progress) return;
        setStage(progress.detail);
        setSteps(progress.steps);
      } catch {
        // A failed poll is not worth reporting; the generation itself reports.
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, buildId]);

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
    /*
      The composer sits at the bottom and stays there.
      
      It used to be the last thing in a scrolling column, so it drifted off
      screen as the build log grew — the input you need most while a build runs
      was the first thing the build pushed out of view.
    */
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
          {/*
            The log replaces the button while a build is running. A spinner on a
            button says something is happening and nothing about what, for the
            two minutes where that is the only question.
          */}
          {pending ? (
            <BuildLog steps={steps} running />
          ) : !hasFiles ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => generate('Build it, exactly as described in the brief.')}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                Generate this app
              </button>
              <p className="mt-2 text-xs text-text-muted">
                Or change the brief first by describing what is wrong with it below.
              </p>
            </div>
          ) : (
            <BuildLog steps={steps} running={false} />
          )}

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

        </div>
      ) : null}
      </div>

      <div className="shrink-0 border-t border-border px-5 py-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const text = prompt.trim();
              /*
               * Retyped text is a request in itself: the person already wrote
               * what they wanted, in the place they wanted it, and asking them
               * to also describe it in a sentence is asking twice.
               */
              if (!text && !edits.textChanges.length) return;
              generate(text || 'Apply the text changes exactly as given.');
            }}
            className="mt-4 rounded-lg border border-border-strong bg-surface p-2"
          >
            {/*
              What this message is about, before what it says. Chips sit above
              the box because they qualify the sentence being typed under them —
              and each carries its own dismissal, since the way to unselect a
              thing is to put back the state you were in before you picked it.
            */}
            {picked || attachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {picked ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-subtle py-1 pl-2 pr-1 text-[0.6875rem] text-accent">
                    {[
                      edits.selection ? `${edits.selection.tag} selected` : null,
                      edits.textChanges.length
                        ? `${edits.textChanges.length} text change${
                            edits.textChanges.length === 1 ? '' : 's'
                          }`
                        : null,
                      edits.annotation ? `drawn over the ${edits.annotation.tag}` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    <button
                      type="button"
                      onClick={clearPreviewEdits}
                      aria-label="Clear what is selected in the preview"
                      className="rounded p-0.5 hover:bg-accent/20"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </span>
                ) : null}
                {attachments.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised py-1 pl-2 pr-1 text-[0.6875rem] text-text-secondary"
                  >
                    {file.filename}
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((entry) => entry.id !== file.id),
                        )
                      }
                      aria-label={`Remove ${file.filename}`}
                      className="rounded p-0.5 hover:bg-surface"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <label htmlFor="build-instruction" className="sr-only">
              What should Reklu build or change?
            </label>
            <textarea
              id="build-instruction"
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                /* Enter sends, as it does everywhere else a message is typed. */
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (pending) return;
                  const text = prompt.trim();
                  if (!text && !edits.textChanges.length) return;
                  generate(text || 'Apply the text changes exactly as given.');
                }
              }}
              placeholder={
                picked
                  ? 'Say what to change about it…'
                  : hasFiles
                    ? "Describe a change, e.g. 'add a settings screen'"
                    : "Or correct the brief, e.g. 'it should also take online orders'"
              }
              className="w-full resize-none bg-transparent px-2 py-1 text-sm text-text placeholder:text-text-muted focus:outline-none"
            />

            <div className="mt-1 flex items-center gap-1.5">
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void attach(event.target.files);
                  /* Cleared, so attaching the same file twice still fires. */
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                aria-label="Attach a file"
                title="Attach a file — a screenshot to match, or a document to build from"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:opacity-40"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Paperclip className="h-4 w-4" strokeWidth={2} />
                )}
              </button>

              <label htmlFor="build-model" className="sr-only">
                Model
              </label>
              <div className="relative inline-flex items-center">
                <Sparkles
                  className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted"
                  strokeWidth={2}
                />
                <select
                  id="build-model"
                  value={modelKey}
                  onChange={(event) => setModelKey(event.target.value)}
                  disabled={pending}
                  className="h-7 appearance-none rounded-md bg-transparent py-0 pl-7 pr-6 text-[0.6875rem] text-text-secondary transition-colors hover:bg-surface-raised focus:outline-none"
                >
                  <option value="auto">Reklu Auto</option>
                  {models.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-1.5 h-3 w-3 text-text-muted"
                  strokeWidth={2}
                />
              </div>

              <button
                type="submit"
                disabled={pending || (!prompt.trim() && !edits.textChanges.length)}
                aria-label="Send"
                className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                )}
              </button>
            </div>
          </form>
      </div>
    </div>
  );
}
