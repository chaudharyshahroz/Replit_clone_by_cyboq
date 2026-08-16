'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Check,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Telescope,
} from 'lucide-react';
import { Markdown } from '@/components/chat/markdown';

export type ResearchMode = 'quick' | 'research' | 'deep';

/** Stage order, mirroring the pipeline. Used to render real progress. */
const STAGE_LABELS: Record<string, string> = {
  analyzing_intent: 'Understanding the question',
  planning: 'Planning the research',
  generating_queries: 'Writing search queries',
  discovering_sources: 'Finding sources',
  fetching_sources: 'Reading sources',
  extracting_content: 'Extracting content',
  ranking_relevance: 'Ranking relevance',
  cross_validating: 'Cross-checking evidence',
  collecting_evidence: 'Collecting evidence',
  reasoning: 'Reasoning',
  writing_report: 'Writing the report',
};

interface StageEntry {
  readonly stage: string;
  readonly detail?: string;
  readonly done: boolean;
}

type ServerEvent =
  | { type: 'start'; sessionId: string; modelKey: string; sources: string[] }
  | { type: 'stage'; stage: string; detail?: string }
  | { type: 'sources'; discovered: number; fetched: number; failed: number }
  | {
      type: 'done';
      report: string;
      answer: string | null;
      sourcesUsed: number;
      sourcesFailed: number;
      fabricatedRemoved: number;
      artifactId: string | null;
    }
  | { type: 'error'; code: string; message: string; retryable: boolean };

const MODES: readonly { value: ResearchMode; label: string; hint: string }[] = [
  { value: 'quick', label: 'Quick', hint: 'A short sourced answer' },
  { value: 'research', label: 'Research', hint: 'Multi-source analysis' },
  { value: 'deep', label: 'Deep', hint: 'Iterative, cross-checked' },
];

export function ResearchView({
  webSearchConfigured,
  searchEnvVars,
}: {
  webSearchConfigured: boolean;
  searchEnvVars: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ResearchMode>('research');
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [counts, setCounts] = useState<{ discovered: number; fetched: number; failed: number }>();
  const [report, setReport] = useState('');
  const [summary, setSummary] = useState<{
    sourcesUsed: number;
    sourcesFailed: number;
    fabricatedRemoved: number;
    artifactId: string | null;
  }>();
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!query.trim() || running) return;

    setRunning(true);
    setError(undefined);
    setStages([]);
    setCounts(undefined);
    setReport('');
    setSummary(undefined);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), mode }),
        signal: controller.signal,
      });

      // Deep mode is queued to the worker (202) rather than streamed, because
      // it can outlast a request. Send the user to the session page to watch it.
      if (response.status === 202) {
        const queued = (await response.json()) as { href?: string };
        if (queued.href) {
          window.location.href = queued.href;
          return;
        }
      }

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? 'Research could not start.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;

          let event: ServerEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as ServerEvent;
          } catch {
            continue;
          }

          if (event.type === 'stage') {
            // Mark previous stages done as each new one is entered — the list
            // reflects where the pipeline actually is, not a timer.
            setStages((prev) => [
              ...prev.map((entry) => ({ ...entry, done: true })),
              { stage: event.stage, detail: event.detail, done: false },
            ]);
          } else if (event.type === 'sources') {
            setCounts({
              discovered: event.discovered,
              fetched: event.fetched,
              failed: event.failed,
            });
          } else if (event.type === 'done') {
            setStages((prev) => prev.map((entry) => ({ ...entry, done: true })));
            setReport(event.report);
            setSummary({
              sourcesUsed: event.sourcesUsed,
              sourcesFailed: event.sourcesFailed,
              fabricatedRemoved: event.fabricatedRemoved,
              artifactId: event.artifactId,
            });
          } else if (event.type === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError') {
        setError('The connection was interrupted.');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [mode, query, running]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header>
        <h1 className="display flex items-center gap-2.5 text-3xl text-text">
          <Telescope className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Research
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Reklu plans the research, reads sources, cross-checks them, and cites every claim.
        </p>
      </header>

      {/* Spec §111: state plainly which source kinds are available. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs text-success">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
          Your files
        </span>
        {webSearchConfigured ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-xs text-success">
            <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
            Web search
          </span>
        ) : (
          <span
            title={`Set ${searchEnvVars.join(' or ')} to enable`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-xs text-text-muted"
          >
            <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
            Web search — not configured
          </span>
        )}
      </div>

      {!webSearchConfigured ? (
        <p className="mt-3 rounded-lg border border-border bg-surface/40 p-3 text-xs leading-relaxed text-text-secondary">
          No web search provider is configured, so Reklu will research across the files in this
          workspace only. It will not answer from the model&rsquo;s memory and present that as
          researched. Set <code className="text-text">SEARCH_PROVIDER</code> and its API key to
          enable the web.
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        className="mt-6 rounded-xl border border-border-strong bg-surface"
      >
        <label htmlFor="research-query" className="sr-only">
          Research question
        </label>
        <textarea
          id="research-query"
          rows={3}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void run();
            }
          }}
          placeholder="What do you want to find out?"
          className="w-full resize-none bg-transparent px-4 pt-4 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              aria-pressed={mode === option.value}
              title={option.hint}
              disabled={running}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                mode === option.value
                  ? 'border-accent-border bg-accent-subtle text-accent'
                  : 'border-border-strong text-text-secondary hover:text-text'
              }`}
            >
              {option.label}
            </button>
          ))}

          <button
            type="submit"
            disabled={running || !query.trim()}
            aria-label="Start research"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            )}
          </button>
        </div>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
          {error}
        </p>
      ) : null}

      {/* Real progress: each row is a stage the pipeline actually entered. */}
      {stages.length > 0 ? (
        <section className="mt-8 rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">Progress</h2>
          <ol className="mt-3 space-y-1.5">
            {stages.map((entry, index) => (
              <li key={`${entry.stage}-${index}`} className="flex items-center gap-2 text-sm">
                {entry.done ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.5} />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
                )}
                <span className={entry.done ? 'text-text-secondary' : 'text-text'}>
                  {STAGE_LABELS[entry.stage] ?? entry.stage}
                </span>
                {entry.detail ? (
                  <span className="text-xs text-text-muted">· {entry.detail}</span>
                ) : null}
              </li>
            ))}
          </ol>

          {counts ? (
            <p className="mt-4 border-t border-border pt-3 text-xs text-text-secondary">
              {counts.fetched} of {counts.discovered} sources retrieved
              {counts.failed > 0 ? (
                <span className="text-warning"> · {counts.failed} could not be read</span>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {report ? (
        <section className="mt-8">
          <article className="rounded-xl border border-border bg-surface/40 p-6">
            <Markdown content={report} />
          </article>

          {summary ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text-muted">
              <span>{summary.sourcesUsed} sources cited</span>
              {summary.sourcesFailed > 0 ? (
                <span className="text-warning">{summary.sourcesFailed} could not be read</span>
              ) : null}
              {/* Surfaced, not hidden: the model tried to invent citations. */}
              {summary.fabricatedRemoved > 0 ? (
                <span className="text-warning">
                  {summary.fabricatedRemoved} unsupported citation
                  {summary.fabricatedRemoved === 1 ? '' : 's'} removed
                </span>
              ) : null}
              {summary.artifactId ? (
                <a
                  href={`/artifacts/${summary.artifactId}`}
                  className="inline-flex items-center gap-1 rounded text-accent hover:text-accent-hover"
                >
                  Open as artifact
                  <ExternalLink className="h-3 w-3" strokeWidth={2} />
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
