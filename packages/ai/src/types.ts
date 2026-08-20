/**
 * The provider abstraction (spec §9).
 *
 * Reklu is never coupled to one AI company. Every provider-specific concern —
 * request shape, streaming protocol, token accounting, error taxonomy — lives
 * behind this interface, inside `providers/`. Nothing outside that directory
 * may import a vendor SDK.
 */
import type { ToolRiskClass } from '@reklu/database';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImagePart {
  readonly type: 'image';
  /** Data URI or https URL. */
  readonly image: string;
  readonly mimeType?: string;
}

export interface FilePart {
  readonly type: 'file';
  readonly data: string;
  readonly mimeType: string;
  readonly filename?: string;
}

export interface ToolCallPart {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export interface ToolResultPart {
  readonly type: 'tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  /**
   * Tool output is untrusted data. It is fenced before it reaches a model and
   * can never redefine instructions — see docs/MCP_SECURITY.md.
   */
  readonly result: unknown;
  readonly isError?: boolean;
}

export interface ReasoningPart {
  readonly type: 'reasoning';
  readonly text: string;
}

export type ContentPart =
  | TextPart
  | ImagePart
  | FilePart
  | ToolCallPart
  | ToolResultPart
  | ReasoningPart;

export interface ModelMessage {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema. */
  readonly parameters: Record<string, unknown>;
  readonly riskClass: ToolRiskClass;
  /**
   * Runs the tool and returns what the model should see.
   *
   * Supplied by the caller, never by this package, because the only correct
   * implementation runs the permission engine first. A tool that is refused
   * still returns text here — the model needs to learn it was refused and say
   * so, rather than the turn failing.
   *
   * Whatever this returns is untrusted data: it came from a third-party
   * server, and it is fenced before it reaches the model.
   */
  readonly execute?: ((args: Record<string, unknown>) => Promise<string>) | undefined;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Provider-side model identifier, resolved from the registry. */
  readonly modelIdentifier: string;
  readonly messages: readonly ModelMessage[];
  /**
   * System instruction. Reklu composes exactly one, from trusted sources only
   * (product rules + project instructions + skills). Retrieved web content,
   * file content, and tool results never reach this field.
   */
  readonly system?: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
  /** Ask for reasoning output where the model supports it. */
  readonly reasoning?: boolean;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cachedInputTokens: number;
}

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'content-filter'
  | 'error'
  | 'cancelled'
  | 'unknown';

export interface GenerateResult {
  readonly text: string;
  readonly reasoning?: string;
  readonly toolCalls: readonly ToolCallPart[];
  readonly usage: TokenUsage;
  readonly finishReason: FinishReason;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * The stream event protocol (spec §104).
 *
 * A discriminated union so the client renders incremental state without
 * guessing. Deliberately includes `status` and `error` as first-class events:
 * a long tool call must be able to report progress, and a mid-stream failure
 * must be distinguishable from a clean finish.
 */
export type StreamEvent =
  | { readonly type: 'start'; readonly modelKey: string; readonly routingReason?: string }
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCall: ToolCallPart }
  | { readonly type: 'tool-result'; readonly toolResult: ToolResultPart }
  | { readonly type: 'status'; readonly stage: string; readonly detail?: string }
  | {
      /**
       * Sources the reply cites, so the client can show what each [n] marker
       * points at rather than only how many there were.
       */
      readonly type: 'sources';
      readonly sources: readonly {
        readonly index: number;
        readonly url: string;
        readonly title: string;
        readonly domain: string | null;
        readonly snippet?: string | null;
      }[];
    }
  | {
      /** A substantial reply was saved as an artifact; the client opens it beside the chat. */
      readonly type: 'artifact';
      readonly artifact: { readonly id: string; readonly title: string; readonly type: string };
    }
  | {
      readonly type: 'finish';
      readonly usage: TokenUsage;
      readonly finishReason: FinishReason;
      readonly messageId?: string;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      /** Already user-safe; internal detail stays in the logs. */
      readonly message: string;
      readonly retryable: boolean;
    };

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly vision: boolean;
  readonly structuredOutput: boolean;
  readonly embeddings: boolean;
  readonly reasoning: boolean;
}

export interface EmbedOptions {
  readonly modelIdentifier: string;
  readonly values: readonly string[];
  readonly signal?: AbortSignal;
}

export interface EmbedResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly inputTokens: number;
}

export interface AIProvider {
  readonly key: string;
  readonly displayName: string;
  /**
   * True for adapters that do not call a real vendor. Surfaced in the UI as
   * "Development Mock" and refused in production (spec §111).
   */
  readonly isDevelopmentMock: boolean;

  capabilities(): ProviderCapabilities;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncIterable<StreamEvent>;
  embed?(options: EmbedOptions): Promise<EmbedResult>;
}

/** Thrown by adapters; normalized into a RekluError at the boundary. */
export class ProviderCallError extends Error {
  readonly providerKey: string;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(params: {
    providerKey: string;
    message: string;
    retryable: boolean;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = 'ProviderCallError';
    this.providerKey = params.providerKey;
    this.retryable = params.retryable;
    this.statusCode = params.statusCode;
  }
}
