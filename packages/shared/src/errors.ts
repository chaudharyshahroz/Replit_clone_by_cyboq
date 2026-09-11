/**
 * Reklu's error taxonomy.
 *
 * Every error carries three separable things:
 *
 *   - `code`      a stable machine identifier the client can branch on
 *   - `message`   internal detail for logs (may name systems and values)
 *   - `userMessage` what a person is shown — actionable, never "Something went wrong"
 *
 * Splitting these is what makes it possible to be genuinely helpful in the UI
 * without leaking infrastructure detail, and to log real diagnostics without
 * writing secrets into the browser.
 */
import { randomBytes } from 'node:crypto';

export type ErrorCode =
  // Authentication / authorization
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'WORKSPACE_ACCESS_DENIED'
  // Input
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  // Limits
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'PAYLOAD_TOO_LARGE'
  // Configuration
  | 'NOT_CONFIGURED'
  | 'FEATURE_DISABLED'
  // External systems
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'UPSTREAM_TIMEOUT'
  // Domain
  | 'JOB_FAILED'
  | 'JOB_CANCELLED'
  | 'SANDBOX_ERROR'
  | 'TOOL_EXECUTION_DENIED'
  // Fallback
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  WORKSPACE_ACCESS_DENIED: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 402,
  PAYLOAD_TOO_LARGE: 413,
  NOT_CONFIGURED: 503,
  FEATURE_DISABLED: 403,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  JOB_FAILED: 500,
  JOB_CANCELLED: 499,
  SANDBOX_ERROR: 500,
  TOOL_EXECUTION_DENIED: 403,
  INTERNAL: 500,
};

/** A follow-up the user can actually take, rendered as a button or link. */
export interface ErrorAction {
  readonly label: string;
  readonly href?: string;
  /** Client-interpreted intent, e.g. 'retry' | 'switch-model' | 'view-logs'. */
  readonly intent?: string;
}

export interface RekluErrorOptions {
  readonly code: ErrorCode;
  /** Internal detail for logs. Never sent to the browser. */
  readonly message: string;
  /** Shown to the user. Should state what happened and what to do next. */
  readonly userMessage: string;
  readonly actions?: readonly ErrorAction[];
  /** Structured, non-sensitive context for logs and debugging. */
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
  /** True when an identical retry could plausibly succeed. */
  readonly retryable?: boolean;
}

export class RekluError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;
  readonly actions: readonly ErrorAction[];
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(options: RekluErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RekluError';
    this.code = options.code;
    this.status = STATUS_BY_CODE[options.code];
    this.userMessage = options.userMessage;
    this.actions = options.actions ?? [];
    this.context = options.context ?? {};
    this.retryable = options.retryable ?? false;
  }

  /** The safe shape sent to clients. Internal `message` is deliberately absent. */
  toClientJSON(): {
    error: {
      code: ErrorCode;
      message: string;
      actions: readonly ErrorAction[];
      retryable: boolean;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        actions: this.actions,
        retryable: this.retryable,
      },
    };
  }
}

export function isRekluError(value: unknown): value is RekluError {
  return value instanceof RekluError;
}

// ---------------------------------------------------------------------------
// Constructors for the cases that recur across the product.
// ---------------------------------------------------------------------------

export const errors = {
  unauthenticated: (detail = 'No authenticated session'): RekluError =>
    new RekluError({
      code: 'UNAUTHENTICATED',
      message: detail,
      userMessage: 'Please sign in to continue.',
      actions: [{ label: 'Sign in', href: '/login' }],
    }),

  forbidden: (detail: string, userMessage = 'You do not have access to this.'): RekluError =>
    new RekluError({ code: 'FORBIDDEN', message: detail, userMessage }),

  workspaceAccessDenied: (workspaceId: string, userId: string): RekluError =>
    new RekluError({
      code: 'WORKSPACE_ACCESS_DENIED',
      message: `User ${userId} is not a member of workspace ${workspaceId}`,
      userMessage: 'You do not have access to this workspace.',
      context: { workspaceId },
    }),

  notFound: (resource: string, id?: string): RekluError =>
    new RekluError({
      code: 'NOT_FOUND',
      message: `${resource}${id ? ` ${id}` : ''} not found`,
      userMessage: `That ${resource.toLowerCase()} no longer exists, or you do not have access to it.`,
      context: id ? { id } : {},
    }),

  validation: (detail: string, fieldErrors?: Record<string, string[]>): RekluError =>
    new RekluError({
      code: 'VALIDATION_FAILED',
      message: detail,
      userMessage: 'Some of the information provided is not valid.',
      context: fieldErrors ? { fieldErrors } : {},
    }),

  rateLimited: (retryAfterSeconds: number, what = 'requests'): RekluError =>
    new RekluError({
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded for ${what}; retry after ${retryAfterSeconds}s`,
      userMessage: `You are sending ${what} faster than your plan allows. Try again in ${formatSeconds(
        retryAfterSeconds,
      )}.`,
      actions: [{ label: 'View plan', href: '/settings/billing' }],
      context: { retryAfterSeconds },
      retryable: true,
    }),

  quotaExceeded: (params: {
    readonly resource: string;
    readonly used: number;
    readonly limit: number;
    readonly resetsAt?: Date;
  }): RekluError =>
    new RekluError({
      code: 'QUOTA_EXCEEDED',
      message: `Quota exceeded for ${params.resource}: ${params.used}/${params.limit}`,
      // Spec §75: explain what was consumed, what remains, and what happens next.
      userMessage:
        `You have used all ${params.limit.toLocaleString()} of your ${params.resource} ` +
        `for this billing period.` +
        (params.resetsAt ? ` This resets on ${formatDate(params.resetsAt)}.` : '') +
        ` Upgrading raises the limit immediately.`,
      actions: [
        { label: 'Upgrade plan', href: '/settings/billing' },
        { label: 'View usage', href: '/settings/usage' },
      ],
      context: { resource: params.resource, used: params.used, limit: params.limit },
    }),

  /**
   * A capability exists in the product but this deployment has not been given
   * the credentials to perform it. Names the exact variables required — the UI
   * shows this rather than a dead button.
   */
  notConfigured: (params: {
    readonly feature: string;
    readonly requiredEnv: readonly string[];
    readonly docsPath?: string;
  }): RekluError =>
    new RekluError({
      code: 'NOT_CONFIGURED',
      message: `${params.feature} is not configured; missing ${params.requiredEnv.join(', ')}`,
      userMessage: `${params.feature} is not configured on this Reklu instance.`,
      actions: params.docsPath ? [{ label: 'Setup guide', href: params.docsPath }] : [],
      context: { requiredEnv: params.requiredEnv },
    }),

  featureDisabled: (flag: string): RekluError =>
    new RekluError({
      code: 'FEATURE_DISABLED',
      message: `Feature flag ${flag} is disabled`,
      userMessage: 'This feature is not available on your account yet.',
      context: { flag },
    }),

  providerUnavailable: (provider: string, model?: string): RekluError =>
    new RekluError({
      code: 'PROVIDER_UNAVAILABLE',
      message: `Provider ${provider} unavailable${model ? ` for model ${model}` : ''}`,
      // Spec §88's worked example.
      userMessage: 'This model is temporarily unavailable. Try Reklu Auto or another model.',
      actions: [{ label: 'Switch to Reklu Auto', intent: 'switch-model' }],
      context: { provider, model },
      retryable: true,
    }),

  providerError: (params: {
    readonly provider: string;
    readonly model?: string;
    readonly detail: string;
    readonly userMessage?: string;
    readonly retryable?: boolean;
  }): RekluError =>
    new RekluError({
      code: 'PROVIDER_ERROR',
      message: `Provider ${params.provider} error: ${params.detail}`,
      userMessage:
        params.userMessage ??
        'The AI provider rejected this request. Try another model, or shorten your input.',
      actions: [{ label: 'Try another model', intent: 'switch-model' }],
      context: { provider: params.provider, model: params.model },
      retryable: params.retryable ?? false,
    }),

  upstreamTimeout: (target: string, ms: number): RekluError =>
    new RekluError({
      code: 'UPSTREAM_TIMEOUT',
      message: `Timed out after ${ms}ms calling ${target}`,
      userMessage: `${target} did not respond in time. This is usually temporary.`,
      actions: [{ label: 'Retry', intent: 'retry' }],
      context: { target, timeoutMs: ms },
      retryable: true,
    }),

  payloadTooLarge: (limitMb: number): RekluError =>
    new RekluError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Upload exceeds ${limitMb}MB limit`,
      userMessage: `That file is larger than the ${limitMb}MB limit.`,
      context: { limitMb },
    }),

  toolExecutionDenied: (params: {
    readonly tool: string;
    readonly riskClass: string;
    readonly reason: string;
  }): RekluError =>
    new RekluError({
      code: 'TOOL_EXECUTION_DENIED',
      message: `Tool ${params.tool} (${params.riskClass}) denied: ${params.reason}`,
      userMessage: `Reklu did not run "${params.tool}" because it ${params.reason}.`,
      context: { tool: params.tool, riskClass: params.riskClass },
    }),

  /**
   * A failure with no useful advice for the person who hit it.
   *
   * The message stays vague on purpose — an internal detail is often a stack
   * frame or a query, and neither belongs on somebody's screen. But "something
   * failed" and nothing else means the only way to learn anything is to open a
   * shell on the server and search its logs for roughly the right minute, which
   * has now been the answer twice.
   *
   * So each one carries a short reference, printed to the reader and logged
   * with the detail. Finding the cause becomes grepping for eight characters
   * that appear exactly once.
   */
  internal: (detail: string, cause?: unknown): RekluError => {
    const reference = randomBytes(4).toString('hex');

    return new RekluError({
      code: 'INTERNAL',
      message: `[${reference}] ${detail}`,
      userMessage: `Something failed on our side. Reference ${reference}.`,
      actions: [{ label: 'Retry', intent: 'retry' }],
      context: { reference },
      cause,
      retryable: true,
    });
  },
} as const;

// ---------------------------------------------------------------------------

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Normalize anything thrown into a RekluError. Unknown throwables become
 * INTERNAL so that a stack trace never reaches the browser.
 */
/**
 * What a model provider said, when it is the provider that refused.
 *
 * An upstream rejection is not our failure and the answer is not in our logs.
 * It is about the request — a model that does not exist on that account, a rate
 * limit, a data policy that has to be accepted before free models are served —
 * and every one of those is something the person can act on, none of it is
 * secret, and none of it can be worked out by reading Reklu's code.
 *
 * Turning those into "something failed on our side" was the difference between
 * a message that fixes the problem and one that starts an investigation.
 */
function providerRejection(thrown: unknown, retryableOverride?: boolean): RekluError | undefined {
  const error = thrown as {
    name?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    url?: unknown;
    message?: unknown;
  };

  /* The AI SDK's shape for an upstream HTTP failure. */
  if (error?.name !== 'AI_APICallError' || typeof error.statusCode !== 'number') return undefined;

  /* The provider's own sentence, which is the part worth reading. */
  let detail = typeof error.message === 'string' ? error.message : 'no detail given';
  if (typeof error.responseBody === 'string') {
    try {
      const body = JSON.parse(error.responseBody) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      /* Not JSON. The message above is what there is. */
    }
  }

  /* The host, never the path: a URL can carry a key in a query string. */
  let provider = 'The model provider';
  if (typeof error.url === 'string') {
    try {
      provider = new URL(error.url).hostname;
    } catch {
      /* Unparseable, so unnamed. */
    }
  }

  return errors.providerError({
    provider,
    detail,
    userMessage: `${provider} refused the request (${error.statusCode}): ${detail.slice(0, 300)}`,
    /*
     * 429 and 5xx are worth trying again; a 4xx about the request is not —
     * unless the adapter, which read the provider's prose rather than only its
     * status code, already decided otherwise. Status alone cannot tell a model
     * that has been retired from one that never existed.
     */
    retryable: retryableOverride ?? (error.statusCode === 429 || error.statusCode >= 500),
  });
}

/**
 * AI adapters deliberately wrap vendor exceptions so callers can reason about
 * retryability without depending on an SDK type. Recognise that public shape
 * here without importing @reklu/ai (which would create a package cycle).
 */
function providerCallFailure(thrown: unknown): RekluError | undefined {
  const error = thrown as {
    name?: unknown;
    providerKey?: unknown;
    statusCode?: unknown;
    retryable?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  if (error?.name !== 'ProviderCallError' || typeof error.providerKey !== 'string') {
    return undefined;
  }

  /*
   * The original AI SDK error has the useful HTTP response and safe advice.
   *
   * Its verdict on retryability is kept, though. The adapter classified this
   * failure by reading what the provider actually said; rebuilding the answer
   * from the status code alone threw that away, and with it every fallback the
   * adapter existed to enable — a 404 saying "no endpoints support image
   * input" was marked retryable there and non-retryable by the time any caller
   * saw it, so the vision fallback could never fire.
   */
  const upstream = providerRejection(
    error.cause,
    error.retryable === true ? true : undefined,
  );
  if (upstream) return upstream;

  const status = typeof error.statusCode === 'number' ? ` (${error.statusCode})` : '';
  const detail = typeof error.message === 'string' ? error.message.trim() : '';

  /*
   * Say what went wrong, not merely that something did.
   *
   * The adapter already wrote a specific, safe sentence for each of these —
   * "The provider did not respond before the request deadline", or the vendor's
   * own words — and this threw all of it away for "could not generate this
   * build. Try Reklu Auto again", which is the same message for a timeout, a
   * cancelled request and a stream that died halfway. A reader cannot tell
   * which happened, so they cannot tell whether waiting, retrying, or changing
   * model is the thing to do.
   */
  const said = detail && detail !== 'No detail given' ? ` ${detail.slice(0, 300)}` : '';

  return errors.providerError({
    provider: error.providerKey,
    detail: detail || 'No detail given',
    userMessage:
      `The ${error.providerKey} model provider could not generate this build${status}.${said} ` +
      'Try Reklu Auto again or choose another model.',
    retryable: error.retryable === true,
  });
}

export function toRekluError(thrown: unknown): RekluError {
  if (isRekluError(thrown)) return thrown;

  const rejection = providerRejection(thrown);
  if (rejection) return rejection;

  const providerFailure = providerCallFailure(thrown);
  if (providerFailure) return providerFailure;

  if (thrown instanceof Error) return errors.internal(thrown.message, thrown);
  return errors.internal(`Non-Error thrown: ${String(thrown)}`, thrown);
}
