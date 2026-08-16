'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowUp, Check, ChevronDown, Loader2, Sparkles, Square } from 'lucide-react';
import { Markdown } from './markdown';

export interface SelectableModel {
  readonly key: string;
  readonly displayName: string;
  readonly providerName: string;
  readonly description: string | null;
  readonly speed: string;
  readonly costTier: string;
  readonly isDevelopmentMock: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly modelKey?: string | null;
}

interface StreamError {
  readonly message: string;
  readonly retryable: boolean;
}

/** Server event shape, mirroring @reklu/ai StreamEvent. */
type ServerEvent =
  | { type: 'start'; modelKey: string; routingReason?: string }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'status'; stage: string; detail?: string }
  | { type: 'finish'; finishReason: string; messageId?: string }
  | { type: 'error'; code: string; message: string; retryable: boolean };

function ModelSelector({
  models,
  value,
  onChange,
  disabled,
}: {
  models: readonly SelectableModel[];
  value: string;
  onChange: (key: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = models.find((m) => m.key === value);
  const label = value === 'auto' ? 'Reklu Auto' : (selected?.displayName ?? 'Select model');

  // Group by provider, preserving server order (spec §11).
  const groups = new Map<string, SelectableModel[]>();
  for (const model of models) {
    const list = groups.get(model.providerName) ?? [];
    list.push(model);
    groups.set(model.providerName, list);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent-border bg-accent-subtle px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent-subtle/70 disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-border-strong bg-surface-raised p-1.5 shadow-2xl shadow-black/50"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === 'auto'}
            onClick={() => {
              onChange('auto');
              setOpen(false);
            }}
            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-text">Reklu Auto</span>
              <span className="block text-xs text-text-secondary">
                Picks the best model for each request
              </span>
            </span>
            {value === 'auto' ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />
            ) : null}
          </button>

          {[...groups.entries()].map(([providerName, list]) => (
            <div key={providerName} className="mt-1">
              <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {providerName}
              </p>
              {list.map((model) => (
                <button
                  key={model.key}
                  type="button"
                  role="option"
                  aria-selected={value === model.key}
                  onClick={() => {
                    onChange(model.key);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-text">{model.displayName}</span>
                      {model.isDevelopmentMock ? (
                        <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-warning">
                          Mock
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {model.speed} · {model.costTier}
                    </span>
                  </span>
                  {value === model.key ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatView({
  models,
  initialMessages,
  initialConversationId,
  devMockActive,
}: {
  models: readonly SelectableModel[];
  initialMessages: readonly ChatMessage[];
  initialConversationId?: string | undefined;
  devMockActive: boolean;
}) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [modelKey, setModelKey] = useState('auto');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [routingReason, setRoutingReason] = useState<string | undefined>();
  const [error, setError] = useState<StreamError | undefined>();
  const [conversationId, setConversationId] = useState(initialConversationId);

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamText]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      setError(undefined);
      setRoutingReason(undefined);
      setInput('');
      setStreaming(true);
      setStreamText('');
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: 'user', text: text.trim() },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      let assembled = '';
      let usedModelKey: string | undefined;
      let createdConversationId: string | undefined;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            conversationId,
            modelKey: modelKey === 'auto' ? undefined : modelKey,
          }),
          signal: controller.signal,
        });

        const returnedId = response.headers.get('X-Conversation-Id');
        if (returnedId) {
          createdConversationId = returnedId;
          setConversationId(returnedId);
        }

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string; retryable?: boolean } }
            | null;
          setError({
            message: payload?.error?.message ?? 'Reklu could not reach the model.',
            retryable: payload?.error?.retryable ?? true,
          });
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
          // The final element may be a partial frame; keep it for the next read.
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

            if (event.type === 'start') {
              usedModelKey = event.modelKey;
              setRoutingReason(event.routingReason);
            } else if (event.type === 'text-delta') {
              assembled += event.text;
              setStreamText(assembled);
            } else if (event.type === 'error') {
              setError({ message: event.message, retryable: event.retryable });
            }
          }
        }

        if (assembled) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              text: assembled,
              modelKey: usedModelKey,
            },
          ]);
        }
      } catch (caught) {
        if ((caught as Error)?.name !== 'AbortError') {
          setError({ message: 'The connection was interrupted.', retryable: true });
        } else if (assembled) {
          setMessages((prev) => [
            ...prev,
            { id: `assistant-${Date.now()}`, role: 'assistant', text: assembled, modelKey: usedModelKey },
          ]);
        }
      } finally {
        setStreaming(false);
        setStreamText('');
        abortRef.current = null;

        // A first message creates the thread server-side. Move to its URL and
        // refresh so the sidebar shows it, without re-rendering the transcript
        // we already hold in state.
        if (!conversationId && createdConversationId) {
          window.history.replaceState(null, '', `/chat/${createdConversationId}`);
          router.refresh();
        }
      }
    },
    [conversationId, modelKey, router, streaming],
  );

  const stop = () => abortRef.current?.abort();

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          {isEmpty ? (
            <div className="pt-16 text-center">
              <h1 className="display text-3xl text-text">What do you want to do?</h1>
              <p className="mt-3 text-text-secondary">
                Ask anything. Reklu picks the right model for each request.
              </p>
              {devMockActive ? (
                <p className="mx-auto mt-8 max-w-md rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-text-secondary">
                  <strong className="text-warning">Development Mock active.</strong> No AI provider
                  key is configured, so replies are generated by a stub that echoes your request —
                  not by a real model.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-6">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} models={models} />
            ))}

            {streaming ? (
              <div>
                {routingReason ? (
                  <p className="mb-2 flex items-center gap-1.5 text-xs text-text-muted">
                    <Sparkles className="h-3 w-3 text-accent" strokeWidth={2} />
                    {routingReason}
                  </p>
                ) : null}
                {streamText ? (
                  <Markdown content={streamText} />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    Thinking…
                  </p>
                )}
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
                <span className="flex-1">{error.message}</span>
                {error.retryable ? (
                  <button
                    type="button"
                    onClick={() => {
                      const last = [...messages].reverse().find((m) => m.role === 'user');
                      if (last) void send(last.text);
                    }}
                    className="shrink-0 rounded-md border border-border-strong px-2 py-1 text-xs text-text-secondary hover:text-text"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---- Composer ---- */}
      <div className="border-t border-border bg-canvas">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
            className="rounded-xl border border-border-strong bg-surface focus-within:border-text-muted"
          >
            <label htmlFor="composer" className="sr-only">
              Ask Reklu anything
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter inserts a newline.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask Reklu anything..."
              className="w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] text-text placeholder:text-text-muted focus:outline-none"
            />

            <div className="flex items-center gap-2 px-3 pb-3">
              <ModelSelector
                models={models}
                value={modelKey}
                onChange={setModelKey}
                disabled={streaming}
              />

              <div className="ml-auto">
                {streaming ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop generating"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong text-text-secondary transition-colors hover:text-text"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
          </form>

          <p className="mt-2 text-center text-[11px] text-text-muted">
            Reklu can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  message,
  models,
}: {
  message: ChatMessage;
  models: readonly SelectableModel[];
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-raised px-4 py-2.5 leading-relaxed text-text">
          {message.text}
        </p>
      </div>
    );
  }

  const model = models.find((m) => m.key === message.modelKey);

  return (
    <div>
      {model ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          {model.displayName}
          {model.isDevelopmentMock ? (
            <span className="rounded border border-warning/40 bg-warning/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-warning">
              Development Mock
            </span>
          ) : null}
        </p>
      ) : null}
      <Markdown content={message.text} />
    </div>
  );
}
