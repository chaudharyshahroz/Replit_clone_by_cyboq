'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Check, Columns2, Loader2 } from 'lucide-react';
import { Markdown } from './markdown';
import type { SelectableModel } from './chat-view';

const MIN_MODELS = 2;
const MAX_MODELS = 4;

interface Column {
  readonly modelKey: string;
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  error?: string;
}

type CompareEvent =
  | { type: 'start'; modelKey: string }
  | { type: 'text-delta'; modelKey: string; text: string }
  | { type: 'finish'; modelKey: string }
  | { type: 'error'; modelKey: string; message: string; retryable: boolean }
  | { type: 'all-finished'; compareGroupId: string; conversationId: string };

export function CompareView({ models }: { models: readonly SelectableModel[] }) {
  const [selected, setSelected] = useState<string[]>(() =>
    models.slice(0, MIN_MODELS).map((m) => m.key),
  );
  const [prompt, setPrompt] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const conversationRef = useRef<string | undefined>(undefined);

  const toggle = (key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) {
        // Never drop below the minimum — a one-model "comparison" is just chat.
        return prev.length > MIN_MODELS ? prev.filter((k) => k !== key) : prev;
      }
      return prev.length < MAX_MODELS ? [...prev, key] : prev;
    });
  };

  const run = useCallback(async () => {
    if (!prompt.trim() || running || selected.length < MIN_MODELS) return;

    setError(undefined);
    setRunning(true);
    setColumns(selected.map((modelKey) => ({ modelKey, text: '', status: 'idle' })));

    try {
      const response = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt.trim(),
          modelKeys: selected,
          conversationId: conversationRef.current,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? 'Compare could not start.');
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

          let event: CompareEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as CompareEvent;
          } catch {
            continue;
          }

          setColumns((prev) =>
            prev.map((column) => {
              if (!('modelKey' in event) || column.modelKey !== event.modelKey) return column;
              switch (event.type) {
                case 'start':
                  return { ...column, status: 'streaming' };
                case 'text-delta':
                  return { ...column, text: column.text + event.text, status: 'streaming' };
                case 'finish':
                  return { ...column, status: 'done' };
                case 'error':
                  return { ...column, status: 'error', error: event.message };
                default:
                  return column;
              }
            }),
          );

          if (event.type === 'all-finished') conversationRef.current = event.conversationId;
        }
      }
    } catch {
      setError('The connection was interrupted.');
    } finally {
      setRunning(false);
    }
  }, [prompt, running, selected]);

  const nameFor = (key: string) => models.find((m) => m.key === key)?.displayName ?? key;
  const isMock = (key: string) => models.find((m) => m.key === key)?.isDevelopmentMock ?? false;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-sm font-medium text-text">
          <Columns2 className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Compare models
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Send one prompt to {MIN_MODELS}–{MAX_MODELS} models and read the answers side by side.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {models.map((model) => {
            const on = selected.includes(model.key);
            const atMax = !on && selected.length >= MAX_MODELS;
            return (
              <button
                key={model.key}
                type="button"
                onClick={() => toggle(model.key)}
                disabled={running || atMax}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                  on
                    ? 'border-accent-border bg-accent-subtle text-accent'
                    : 'border-border-strong text-text-secondary hover:text-text'
                }`}
              >
                {on ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                {model.displayName}
                {model.isDevelopmentMock ? (
                  <span className="rounded border border-warning/40 bg-warning/10 px-1 text-[0.5625rem] uppercase text-warning">
                    Mock
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
            {error}
          </p>
        ) : null}

        {columns.length === 0 ? (
          <div className="pt-20 text-center">
            <p className="text-text-secondary">
              Pick your models, write a prompt, and compare the answers.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr))` }}
          >
            {columns.map((column) => (
              <section
                key={column.modelKey}
                className="flex min-w-0 flex-col rounded-xl border border-border bg-surface/40"
              >
                <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <h2 className="truncate text-sm font-medium text-text">
                    {nameFor(column.modelKey)}
                  </h2>
                  {isMock(column.modelKey) ? (
                    <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 text-[0.5625rem] uppercase text-warning">
                      Mock
                    </span>
                  ) : null}
                  {column.status === 'streaming' ? (
                    <Loader2
                      className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-text-muted"
                      strokeWidth={2}
                    />
                  ) : null}
                </header>

                <div className="min-w-0 flex-1 overflow-x-auto p-4 text-sm">
                  {column.status === 'error' ? (
                    <p className="flex items-start gap-2 text-danger">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                      {column.error}
                    </p>
                  ) : column.text ? (
                    <Markdown content={column.text} />
                  ) : (
                    <p className="text-text-muted">Waiting…</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border-strong bg-surface p-2"
        >
          <label htmlFor="compare-prompt" className="sr-only">
            Prompt to compare
          </label>
          <textarea
            id="compare-prompt"
            rows={2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void run();
              }
            }}
            placeholder="Ask all selected models the same question..."
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] text-text placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={running || !prompt.trim()}
            aria-label="Compare"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
