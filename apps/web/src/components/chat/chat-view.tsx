'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  ImagePlus,
  Loader2,
  ExternalLink,
  Paperclip,
  PanelRightClose,
  Plus,
  Sparkles,
  Square,
  Telescope,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Markdown } from './markdown';
import { SourcesPanel } from './sources-panel';
import { MessageActions } from './message-actions';
import type { CitedSource } from '@/lib/citations';
import { composerSize } from '@/lib/composer-size';

/**
 * The composer's tools.
 *
 * Each runs inside this conversation rather than sending you to another page:
 * the request, the progress and the result all land in the transcript you are
 * already reading. The server delegates to the same package the dedicated
 * surface uses, so the behaviour is not a thinner copy of it.
 *
 * A tool stays selected until it is removed, so a follow-up question does the
 * same kind of work. The chip in the composer is what says so.
 *
 * With no tool selected this is ordinary chat, which is the default because it
 * is what most requests are.
 */
export type ToolKey = 'chat' | 'build' | 'image' | 'research';

interface ToolDefinition {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly placeholder: string;
  readonly hint: string;
  readonly suggestions: readonly string[];
}

const TOOLS: Record<Exclude<ToolKey, 'chat'>, ToolDefinition> = {
  build: {
    label: 'Build',
    icon: Wrench,
    placeholder: 'Describe the app or site you want built…',
    hint: 'Reklu writes the code and runs it in an isolated sandbox.',
    suggestions: [
      'A booking page for a barber shop with opening hours',
      'A landing page for a productivity app, with pricing',
      'A dashboard showing sales by region from a CSV',
    ],
  },
  image: {
    label: 'Image',
    icon: ImagePlus,
    placeholder: 'Describe the image you want…',
    hint: 'Generated images are saved to Artifacts.',
    suggestions: [
      'A minimal logo for a coffee roastery, flat vector',
      'A hero illustration of a city at dusk, muted palette',
      'A product photo of a ceramic mug on linen',
    ],
  },
  research: {
    label: 'Research',
    icon: Telescope,
    placeholder: 'What should Reklu research?',
    hint: 'Answers come back with sources you can open and check.',
    suggestions: [
      'Compare the three biggest AI note-taking apps on pricing and privacy',
      'What changed in EU data rules for SaaS in the last year?',
      'Who are the main competitors in home espresso machines?',
    ],
  },
};

/** Openers for plain chat, shown when no tool is selected. */
const CHAT_SUGGESTIONS: readonly string[] = [
  'Explain what this codebase does',
  'Draft a launch email for a new feature',
  'Turn these notes into a summary',
];

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
  /** Sources this reply cites, when it is a research answer. */
  readonly sources?: readonly CitedSource[];
  /** Whether the reader rated this reply. */
  readonly feedback?: 'up' | 'down';
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly modelKey?: string | null;
  readonly attachments?: readonly string[];
}

export interface UploadedFile {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly statusDetail?: string | null;
  /** False when the file was stored but its text could not be read. */
  readonly usableInChat: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

interface StreamError {
  readonly message: string;
  readonly retryable: boolean;
}

/** Server event shape, mirroring @reklu/ai StreamEvent. */
/**
 * A hand-written copy of the server's StreamEvent union.
 *
 * It drifts. A `sources` event was added to the protocol and this file kept
 * compiling and silently ignored it, because nothing ties the two together.
 * Importing the type from @reklu/ai would fix that permanently — `import type`
 * is erased at build time and allowed past the server-only check — and is
 * worth doing next time this list is touched.
 */
/** Server stage names, in the words a reader would use. */
const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning the research',
  discovering_sources: 'Finding sources',
  fetching_sources: 'Reading sources',
  extracting: 'Pulling out the relevant passages',
  cross_checking: 'Cross-checking claims',
  writing_report: 'Writing the answer',
  generating: 'Generating the image',
};

type ServerEvent =
  | { type: 'start'; modelKey: string; routingReason?: string }
  | {
      type: 'sources';
      sources: readonly {
        index: number;
        url: string;
        title: string;
        domain: string | null;
        snippet?: string | null;
      }[];
    }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolCall: { toolName?: string; name?: string } }
  | { type: 'tool-result'; toolResult: unknown }
  | { type: 'status'; stage: string; detail?: string }
  | { type: 'artifact'; artifact: { id: string; title: string; type: string } }
  | { type: 'finish'; finishReason: string; messageId?: string }
  | { type: 'error'; code: string; message: string; retryable: boolean };

function ModelSelector({
  models,
  value,
  onChange,
  disabled,
  placement = 'up',
}: {
  models: readonly SelectableModel[];
  value: string;
  onChange: (key: string) => void;
  disabled: boolean;
  /** The header sits at the top of the screen, so its list opens downward. */
  placement?: 'up' | 'down';
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
          className={`absolute left-0 z-30 max-h-96 w-80 overflow-y-auto rounded-xl border border-border-strong bg-surface-raised p-1.5 shadow-2xl shadow-black/50 ${
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
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
              <p className="px-2.5 py-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
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
                        <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-[0.5625rem] font-medium uppercase tracking-wide text-warning">
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
  initialInput,
  initialConversationId,
  devMockActive,
}: {
  models: readonly SelectableModel[];
  initialMessages: readonly ChatMessage[];
  /**
   * Prefilled composer text, carried from the landing page.
   *
   * The question is placed in the box rather than sent, so the first thing a
   * new account does is still a deliberate act — arriving to find a request
   * already in flight would be startling, and it would spend their quota
   * before they had chosen to.
   */
  initialInput?: string;
  initialConversationId?: string | undefined;
  devMockActive: boolean;
}) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [input, setInput] = useState(initialInput ?? '');
  const [modelKey, setModelKey] = useState('auto');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [routingReason, setRoutingReason] = useState<string | undefined>();
  const [error, setError] = useState<StreamError | undefined>();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [tool, setTool] = useState<ToolKey>('chat');
  const [dragging, setDragging] = useState(false);
  const [streamSources, setStreamSources] = useState<readonly CitedSource[]>([]);
  /** The stage the server is currently in, when it reports one. */
  const [stage, setStage] = useState<{ label: string; detail?: string } | undefined>();
  /**
   * The model the server actually chose for this turn.
   *
   * Not `modelKey`: that is the *selection*, which is "auto" for most people,
   * and naming it would show "Working" to everyone using Reklu Auto — exactly
   * the case the label exists for.
   */
  const [resolvedModelKey, setResolvedModelKey] = useState<string | undefined>();
  /** When the current turn started, for the elapsed counter. */
  const [startedAt, setStartedAt] = useState<number | undefined>();
  const [elapsed, setElapsed] = useState(0);

  /**
   * Elapsed seconds while waiting.
   *
   * For a plain chat turn there is genuinely one thing happening — the model is
   * generating — so there are no stages to report and inventing some would be
   * fake progress. What can honestly be shown is how long it has been, which is
   * the thing a waiting reader actually wants to know.
   */
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(tick);
  }, [startedAt]);
  const [artifact, setArtifact] = useState<
    { id: string; title: string; type: string } | undefined
  >(undefined);

  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * The composer grows with what is typed, up to three lines.
   *
   * A fixed two-row box wastes half its height on an empty conversation and
   * gives a long prompt no room at all. MAX_COMPOSER_LINES is where it stops:
   * past that the box starts eating the conversation it belongs to, so it
   * scrolls instead.
   *
   * Measured from the element's own computed styles rather than hard-coded
   * pixels, so it stays correct as the type scale moves — which it has, three
   * times.
   */
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;

    field.style.height = 'auto';

    const styles = getComputedStyle(field);
    const { height, overflowY } = composerSize({
      scrollHeight: field.scrollHeight,
      lineHeight: Number.parseFloat(styles.lineHeight) || 20,
      paddingTop: Number.parseFloat(styles.paddingTop) || 0,
      paddingBottom: Number.parseFloat(styles.paddingBottom) || 0,
    });

    field.style.height = `${height}px`;
    field.style.overflowY = overflowY;
  }, [input]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamText]);

  const send = useCallback(
    async (text: string, options?: { regenerate?: boolean }) => {
      if (!text.trim() || streaming) return;

      setError(undefined);
      setRoutingReason(undefined);
      setInput('');
      setStreaming(true);
      setStreamText('');
      setStartedAt(Date.now());
      setResolvedModelKey(undefined);
      // Belongs to the turn being sent, not the one before it.
      setStreamSources([]);
      setStage(undefined);
      const attachedNames = attachments.map((file) => file.filename);
      // A retry re-asks a question already on screen; echoing it again would
      // show it twice.
      if (!options?.regenerate) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            role: 'user',
            text: text.trim(),
            attachments: attachedNames,
          },
        ]);
      }
      // Cleared immediately: a file belongs to the turn that sent it.
      setAttachments([]);

      const controller = new AbortController();
      abortRef.current = controller;
      let assembled = '';
      let capturedSources: readonly CitedSource[] = [];
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
            fileIds: attachments.map((file) => file.id),
            /*
             * The selected tool runs inside this conversation. It stays
             * selected until removed, which is what the chip in the composer
             * is showing — the next message will do the same thing.
             */
            ...(tool !== 'chat' ? { tool } : {}),
            ...(options?.regenerate ? { regenerate: true } : {}),
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
              setResolvedModelKey(event.modelKey);
              setRoutingReason(event.routingReason);
            } else if (event.type === 'text-delta') {
              assembled += event.text;
              setStreamText(assembled);
              // Text is arriving, so whatever came before it is over.
              setStage(undefined);
            } else if (event.type === 'tool-call') {
              /*
               * Real work with a name. The server already forwarded these and
               * the client dropped them, so a turn that spent ten seconds
               * calling a connector looked identical to one that was simply
               * thinking.
               */
              const name = event.toolCall.toolName ?? event.toolCall.name;
              setStage({ label: name ? `Using ${name}` : 'Using a connected tool' });
            } else if (event.type === 'tool-result') {
              setStage({ label: 'Reading the result' });
            } else if (event.type === 'reasoning-delta') {
              /*
               * A real signal, not a guess: the model is emitting reasoning
               * tokens. Only the fact is shown, never the content — the raw
               * chain of thought is not ours to display.
               */
              setStage({ label: 'Reasoning' });
            } else if (event.type === 'status') {
              /*
               * Real stages from the server, not a spinner pretending to know
               * what is happening. Research reports "finding sources",
               * "reading sources" and so on as it enters each one.
               */
              setStage({ label: STAGE_LABELS[event.stage] ?? event.stage, detail: event.detail });
            } else if (event.type === 'sources') {
              /*
               * Kept in a local as well as in state.
               *
               * The commit below runs inside this same closure, where the state
               * variable is still whatever it was when `send` was created —
               * empty. Reading it there attached nothing, so the sources panel
               * never appeared even though the sources had arrived.
               */
              capturedSources = event.sources;
              setStreamSources(event.sources);
            } else if (event.type === 'artifact') {
              // Spec §20: a substantial output opens beside the chat.
              setArtifact(event.artifact);
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
              ...(capturedSources.length > 0 ? { sources: capturedSources } : {}),
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
        setStage(undefined);
        setStartedAt(undefined);
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
    [attachments, conversationId, modelKey, router, streaming, tool],
  );

  const upload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(undefined);

    for (const file of Array.from(fileList)) {
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await fetch('/api/files/upload', { method: 'POST', body: form });
        const payload = (await response.json()) as
          | { file: UploadedFile }
          | { error: { message: string } };

        if (!response.ok || !('file' in payload)) {
          setError({
            message:
              'error' in payload ? payload.error.message : `Could not upload ${file.name}.`,
            retryable: false,
          });
          continue;
        }
        setAttachments((prev) => [...prev, payload.file]);
      } catch {
        setError({ message: `Could not upload ${file.name}.`, retryable: false });
      }
    }

    setUploading(false);
    // Reset so re-selecting the same file fires a change event again.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const stop = () => abortRef.current?.abort();

  /**
   * Ask the same question again, replacing the answer rather than adding a
   * turn.
   *
   * The reply is dropped from view first, so the transcript never shows the
   * old answer and the new one at once. The server is told this is a retry so
   * it does not record the question a second time.
   */
  const regenerate = useCallback((): void => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser || streaming) return;

    setMessages((previous) => {
      const last = previous[previous.length - 1];
      return last?.role === 'assistant' ? previous.slice(0, -1) : previous;
    });

    void send(lastUser.text, { regenerate: true });
  }, [messages, send, streaming]);

  const isEmpty = messages.length === 0 && !streaming;

  /** The model handling this turn, once the server has named it. */
  const waitingFor = models.find((entry) => entry.key === resolvedModelKey)?.displayName;

  /*
   * Whether anything in view carries sources, which decides how wide the
   * transcript runs. Checked across the thread rather than per message so the
   * column does not jump width between turns as you scroll.
   */
  const hasSources =
    streamSources.length > 0 || messages.some((message) => (message.sources?.length ?? 0) > 0);

  /**
   * Two widths, because they answer different questions.
   *
   * `max-w-3xl` is 48rem, and rem now resolves against a 77% root — so the
   * whole column silently shrank by a quarter along with the type, leaving a
   * ribbon of text between two very wide empty margins.
   *
   * Widening the text to fill that space would trade one problem for a worse
   * one: a line much past ~75 characters is measurably harder to read, and the
   * eye loses its place returning to the left edge. So the *container* grows to
   * use the room, and the *prose* stays at a readable measure — the freed space
   * goes to the sources panel, which is reference material and reads fine
   * narrow.
   *
   * Both are in `ch`, tied to the font itself, so neither drifts again the next
   * time the type scale moves.
   */
  const COLUMN = 'w-full max-w-[104ch]';

  /**
   * The reading measure.
   *
   * 86ch rather than the ~72 that pure typography would pick: the answer sits
   * beside a panel, and holding the text too narrow opened a corridor of dead
   * space between the two. This is at the wide end of comfortable and closes
   * the gap without the line becoming hard to track.
   */
  const PROSE = 'max-w-[86ch]';

  /**
   * A research answer is wider than a conversation.
   *
   * It carries a sources panel, and centring that inside the ordinary column
   * left a wide empty margin on both sides while squeezing the panel against
   * the text. This lets those turns use the room: the prose keeps its measure
   * on the left, the panel goes to the right edge, and the space between them
   * is space rather than cramped columns.
   *
   * Only for turns that have sources. An ordinary reply has nothing to put out
   * there, and a lone sentence stretched across a wide screen reads worse, not
   * better.
   */
  const WIDE = 'w-full max-w-[128ch]';

  /*
   * Only on an empty conversation. Once there is a transcript to read, openers
   * are clutter — and they were still showing mid-thread whenever a tool was
   * selected, which is most of the time a tool is used.
   */
  const showSuggestions = isEmpty && input.trim().length === 0;

  /*
   * Extracted so the empty state and the running conversation render the
   * *same* composer. Two copies would drift — and the one people meet first
   * is the one that would fall behind.
   */
  const composer = (
    <>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send(input);
      }}
      /*
       * Files can be dropped anywhere on the composer, not only through the
       * file picker. dragenter/dragover must both preventDefault or the
       * browser navigates to the dropped file instead of handing it over.
       */
      onDragEnter={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        // Ignore the events fired while crossing between child elements.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
      }}
      /*
       * Focus is shown on the frame, not inside it. A textarea matches
       * :focus-visible even when clicked with a mouse, so the global accent
       * ring (spec §99) drew a bright outline around the input every time
       * anyone clicked to type. The indicator is still here and still meets
       * the requirement — it is simply the composer's own border brightening,
       * which is what the shape already suggested.
       */
      className={`relative rounded-xl border bg-surface transition-colors ${
        dragging
          ? 'border-accent bg-accent-subtle/30'
          : 'border-border-strong focus-within:border-text-muted focus-within:ring-1 focus-within:ring-text-muted/40'
      }`}
    >
      {dragging ? (
        <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-canvas/80 text-sm font-medium text-accent">
          Drop files to attach
        </p>
      ) : null}
      <label htmlFor="composer" className="sr-only">
        Ask Reklu anything
      </label>
      <textarea
        id="composer"
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter inserts a newline.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send(input);
          }
        }}
        placeholder={tool === 'chat' ? 'Ask Reklu anything…' : TOOLS[tool].placeholder}
        className="w-full resize-none bg-transparent px-4 pt-3.5 text-[0.9375rem] text-text placeholder:text-text-muted focus:outline-none focus-visible:outline-none"
      />

      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-3 pb-1">
          {attachments.map((file) => (
            <li
              key={file.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                file.usableInChat
                  ? 'border-border-strong text-text-secondary'
                  : 'border-warning/40 bg-warning/5 text-warning'
              }`}
            >
              <Paperclip className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="max-w-[14rem] truncate">{file.filename}</span>
              <span className="text-text-muted">{formatBytes(file.sizeBytes)}</span>
              <button
                type="button"
                onClick={() =>
                  setAttachments((prev) => prev.filter((f) => f.id !== file.id))
                }
                aria-label={`Remove ${file.filename}`}
                className="rounded text-text-muted hover:text-text"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Honest about files that were stored but could not be read. */}
      {attachments.some((f) => !f.usableInChat) ? (
        <p className="px-3 pb-1 text-[0.6875rem] leading-relaxed text-warning">
          {attachments.find((f) => !f.usableInChat)?.statusDetail ??
            'Some attachments could not be read and will be described to the model rather than included.'}
        </p>
      ) : null}

      <div className="flex items-center gap-2 px-3 pb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => void upload(event.target.files)}
        />
        {/*
          One + for everything you can add to a request: files, or a tool that
          sends it somewhere other than plain chat.
        */}
        <Menu
          label="Add files or a tool"
          side="top"
          panelClassName="w-60"
          triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong text-text-secondary transition-colors hover:text-text disabled:opacity-40"
          trigger={
            uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2} />
            )
          }
        >
          {(close) => (
            <>
              <MenuItem
                onSelect={() => {
                  fileInputRef.current?.click();
                  close();
                }}
              >
                <Paperclip className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                Attach files
              </MenuItem>

              <MenuSeparator label="Tools" />

              {(Object.keys(TOOLS) as Exclude<ToolKey, 'chat'>[]).map((key) => {
                const definition = TOOLS[key];
                const Icon = definition.icon;
                const selected = tool === key;
                return (
                  <MenuItem
                    key={key}
                    onSelect={() => {
                      // Choosing the tool already active turns it off, so the
                      // same control both sets and clears.
                      setTool(selected ? 'chat' : key);
                      close();
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="flex-1">{definition.label}</span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />
                    ) : null}
                  </MenuItem>
                );
              })}
            </>
          )}
        </Menu>

        {/* The active tool, always visible and always removable. */}
        {tool !== 'chat'
          ? (() => {
              const definition = TOOLS[tool];
              const Icon = definition.icon;
              return (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent-border bg-accent-subtle px-2.5 text-xs font-medium text-accent">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {definition.label}
                  <button
                    type="button"
                    onClick={() => setTool('chat')}
                    aria-label={`Turn off ${definition.label}`}
                    className="rounded text-accent/70 transition-colors hover:text-accent"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                </span>
              );
            })()
          : null}

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

    {/*
      Openers, not decoration: clicking one puts it in the composer so it can
      still be edited before sending. They follow the selected tool, because a
      good research prompt is not a good image prompt.
    */}
    {showSuggestions ? (
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {(tool === 'chat' ? CHAT_SUGGESTIONS : TOOLS[tool].suggestions).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              setInput(suggestion);
              textareaRef.current?.focus();
            }}
            className="max-w-full truncate rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text"
          >
            {suggestion}
          </button>
        ))}
      </div>
    ) : null}

    {tool !== 'chat' ? (
      <p className="mt-3 text-center text-[0.6875rem] text-text-muted">{TOOLS[tool].hint}</p>
    ) : null}

    <p className="mt-2 text-center text-[0.6875rem] text-text-muted">
      Reklu can make mistakes. Verify important information.
    </p>
    </>
  );


  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          The model belongs to the conversation, not to one message, so it sits
          in a header rather than inside the composer — visible and changeable
          at any point, without competing with the controls that act on what
          you are typing.

          No rule under it: the chip is its own anchor, and a full-width line
          across an otherwise empty screen reads as a seam rather than a
          divider.
        */}
        <header className="flex h-12 shrink-0 items-center px-4">
          <ModelSelector
            models={models}
            value={modelKey}
            onChange={setModelKey}
            disabled={streaming}
            placement="down"
          />
        </header>

        {isEmpty ? (
          /*
           * Nothing has been said yet, so the composer is the page: heading and
           * input sit together in the middle, the way every assistant opens.
           * Docking it to the bottom of an empty screen strands it under a
           * blank expanse.
           */
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
            <div className={COLUMN}>
              <div className="text-center">
                <h1 className="display text-3xl text-text">What do you want to do?</h1>
                <p className="mt-3 text-text-secondary">
                  Ask anything. Reklu picks the right model for each request.
                </p>
                {devMockActive ? (
                  <p className="mx-auto mt-8 max-w-md rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-text-secondary">
                    <strong className="text-warning">Development Mock active.</strong> No AI
                    provider key is configured, so replies are generated by a stub that echoes
                    your request — not by a real model.
                  </p>
                ) : null}
              </div>
              <div className="mt-8">{composer}</div>
            </div>
          </div>
        ) : (
          <>
            {/* Once the conversation is running the transcript leads and the
                composer docks below it. */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className={`mx-auto ${hasSources ? WIDE : COLUMN} px-6 py-10`}>
                <div className="space-y-6">
                  {messages.map((message) => (
                    <Bubble
                      key={message.id}
                      message={message}
                      models={models}
                      prose={PROSE}
                      /*
                       * Only the last reply can be redone. Regenerating an
                       * earlier one would orphan everything said after it.
                       */
                      onRegenerate={
                        message.role === 'assistant' &&
                        message.id === messages[messages.length - 1]?.id &&
                        !streaming
                          ? regenerate
                          : undefined
                      }
                    />
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
                        <div className={PROSE}>
                          <Markdown content={streamText} citations={streamSources} />
                        </div>
                      ) : (
                        /*
                         * The stage the server actually reported, when it
                         * reported one. "Thinking…" is the honest fallback for
                         * a plain chat turn, where there are no stages to show
                         * — inventing some would be fake progress (spec §106).
                         */
                        <p className="flex items-center gap-2 text-sm text-text-muted">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                          {stage ? (
                            <>
                              {stage.label}
                              {stage.detail ? (
                                <span className="text-text-muted/70">· {stage.detail}</span>
                              ) : null}
                            </>
                          ) : (
                            /*
                             * Named, because "Thinking" describes nothing. The
                             * model is the one real fact available at this
                             * point in a plain turn.
                             */
                            <>
                              {waitingFor ? `${waitingFor} is working` : 'Working'}
                            </>
                          )}
                          {/* Elapsed time is real information; stages here would not be. */}
                          {elapsed >= 2 ? (
                            <span className="tabular-nums text-text-muted/60">{elapsed}s</span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  ) : null}

                  {error ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
                    >
                      <AlertCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                        strokeWidth={2}
                      />
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

            {/*
              No rule above the composer: the transcript already ends where the
              composer begins, and a full-width line across the bottom of the
              screen reads as a seam rather than a boundary.
            */}
            <div className="bg-canvas">
              <div className={`mx-auto ${COLUMN} px-6 py-4`}>{composer}</div>
            </div>
          </>
        )}
      </div>


      {/* Artifact workspace beside the chat (spec §20). */}
      {artifact ? (
        <aside className="hidden w-96 shrink-0 flex-col border-l border-border bg-surface/30 lg:flex">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">
                {artifact.title}
              </span>
              <span className="block text-[0.6875rem] text-text-muted">
                {artifact.type.replace(/_/g, ' ')} · saved to Artifacts
              </span>
            </span>
            <a
              href={`/artifacts/${artifact.id}`}
              aria-label="Open artifact in full view"
              className="rounded p-1 text-text-muted transition-colors hover:text-text"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            </a>
            <button
              type="button"
              onClick={() => setArtifact(undefined)}
              aria-label="Close artifact panel"
              className="rounded p-1 text-text-muted transition-colors hover:text-text"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 text-sm">
            <p className="text-text-secondary">
              Reklu saved this response as an artifact. Open it to edit, revise, or view its
              version history.
            </p>
            <a
              href={`/artifacts/${artifact.id}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text transition-colors hover:bg-surface-hover"
            >
              Open artifact
              <ExternalLink className="h-3 w-3" strokeWidth={2} />
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function Bubble({
  message,
  models,
  prose,
  onRegenerate,
}: {
  message: ChatMessage;
  models: readonly SelectableModel[];
  /** The readable measure for body text, set by the view. */
  prose: string;
  /** Supplied only for the most recent reply. */
  onRegenerate?: (() => void) | undefined;
}) {
  if (message.role === 'user') {
    return (
      /*
       * Held to the prose column rather than the full width.
       *
       * Right-aligned inside the wide research layout it drifted out over the
       * sources panel, so a question sat above a column it had nothing to do
       * with. It belongs above the answer it produced.
       */
      <div className={`group/message flex flex-col items-end gap-1.5 ${prose}`}>
        {message.attachments && message.attachments.length > 0 ? (
          <ul className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((name) => (
              <li
                key={name}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[0.6875rem] text-text-muted"
              >
                <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-raised px-4 py-2.5 leading-relaxed text-text">
          {message.text}
        </p>
        <MessageActions text={message.text} />
      </div>
    );
  }

  const model = models.find((m) => m.key === message.modelKey);

  return (
    <div className="group/message">
      {model ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          {model.displayName}
          {model.isDevelopmentMock ? (
            <span className="rounded border border-warning/40 bg-warning/10 px-1 py-px text-[0.5625rem] font-medium uppercase tracking-wide text-warning">
              Development Mock
            </span>
          ) : null}
        </p>
      ) : null}

      {/*
        A research answer reads as two columns on a wide screen: the answer,
        and what it rests on. Below `lg` the panel stacks above the text
        instead — beside is a luxury of width, not a requirement.
      */}
      {message.sources && message.sources.length > 0 ? (
        <div className="lg:flex lg:items-start lg:gap-6">
          <div className={`min-w-0 lg:flex-1 ${prose}`}>
            <Markdown content={message.text} citations={message.sources} />
          </div>
          <div className="mt-4 lg:sticky lg:top-4 lg:mt-0 lg:w-72 lg:shrink-0">
            <SourcesPanel sources={message.sources} />
          </div>
        </div>
      ) : (
        <div className={prose}>
          <Markdown content={message.text} />
        </div>
      )}

      <div className={prose}>
        <MessageActions
          text={message.text}
          messageId={message.id.startsWith('assistant-') ? undefined : message.id}
          initialFeedback={message.feedback}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}
