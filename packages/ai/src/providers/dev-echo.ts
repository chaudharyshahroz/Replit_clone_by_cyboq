/**
 * Development mock provider (spec §111).
 *
 * Exists so the full streaming pipeline — route, SSE protocol, persistence,
 * usage ledger, UI rendering — can be exercised without a vendor API key.
 *
 * Three rules keep it honest:
 *   1. It refuses to load when NODE_ENV=production.
 *   2. `isDevelopmentMock` is true, and every surface that shows a model must
 *      render "Development Mock" beside it.
 *   3. It never pretends to be intelligent. It echoes back a description of
 *      what it received, so nobody can mistake its output for a real answer.
 */
import type {
  AIProvider,
  GenerateOptions,
  GenerateResult,
  ProviderCapabilities,
  StreamEvent,
  TokenUsage,
} from '../types';

export const DEV_ECHO_PROVIDER_KEY = 'dev-echo';
export const DEV_ECHO_MODEL_KEY = 'dev-echo-1';

/**
 * A second mock variant, so Compare Mode (which requires two models) can be
 * exercised on an instance with no provider keys. It streams at a different
 * rate from the first, which makes concurrent fan-out visibly concurrent
 * rather than something that merely looks right in a screenshot.
 *
 * Both variants are labelled "Development Mock" everywhere and bill zero units.
 */
export const DEV_ECHO_SLOW_MODEL_KEY = 'dev-echo-2';

const CHUNK_DELAY_MS: Record<string, number> = {
  [DEV_ECHO_MODEL_KEY]: 8,
  [DEV_ECHO_SLOW_MODEL_KEY]: 22,
};

const CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  tools: false,
  vision: false,
  structuredOutput: false,
  embeddings: false,
  reasoning: false,
};

/** Rough token estimate — good enough to exercise the accounting path. */
const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

function describeRequest(options: GenerateOptions): string {
  const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
  const userText =
    lastUser?.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ') ?? '(no text)';

  return [
    'This response came from the **Development Mock** provider, not a real model.',
    '',
    'No AI provider key is configured on this instance, so Reklu cannot produce a',
    'genuine answer. This adapter exists only to exercise the streaming pipeline',
    'end to end — routing, persistence, usage accounting and rendering.',
    '',
    '**What Reklu received**',
    '',
    `- Messages in context: ${options.messages.length}`,
    `- System instruction: ${options.system ? `${estimateTokens(options.system)} tokens` : 'none'}`,
    `- Tools offered: ${options.tools?.length ?? 0}`,
    `- Your message: "${userText.slice(0, 300)}${userText.length > 300 ? '…' : ''}"`,
    '',
    'Add `ANTHROPIC_API_KEY` (or another provider key) to `.env` and restart to',
    'get real answers.',
  ].join('\n');
}

function usageFor(options: GenerateOptions, output: string): TokenUsage {
  const inputText =
    (options.system ?? '') +
    options.messages
      .flatMap((m) => m.content)
      .map((p) => ('text' in p ? p.text : ''))
      .join(' ');
  return {
    inputTokens: estimateTokens(inputText),
    outputTokens: estimateTokens(output),
    reasoningTokens: 0,
    cachedInputTokens: 0,
  };
}

export function createDevEchoProvider(): AIProvider {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'The development mock provider must never be registered in production. ' +
        'Configure a real AI provider key.',
    );
  }

  return {
    key: DEV_ECHO_PROVIDER_KEY,
    displayName: 'Development Mock',
    isDevelopmentMock: true,
    capabilities: () => CAPABILITIES,

    async generate(options: GenerateOptions): Promise<GenerateResult> {
      const text = describeRequest(options);
      return {
        text,
        toolCalls: [],
        usage: usageFor(options, text),
        finishReason: 'stop',
      };
    },

    async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
      const text = describeRequest(options);
      const delay = CHUNK_DELAY_MS[options.modelIdentifier] ?? 8;

      // Emit in chunks so the client's incremental rendering is genuinely
      // exercised rather than receiving one blob.
      const tokens = text.split(/(\s+)/);
      for (const token of tokens) {
        if (options.signal?.aborted) {
          yield { type: 'finish', usage: usageFor(options, text), finishReason: 'cancelled' };
          return;
        }
        yield { type: 'text-delta', text: token };
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      yield { type: 'finish', usage: usageFor(options, text), finishReason: 'stop' };
    },
  };
}
