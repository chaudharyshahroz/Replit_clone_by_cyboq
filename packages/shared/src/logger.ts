/**
 * Structured logging with mandatory redaction.
 *
 * Reklu handles provider keys, user OAuth tokens, and MCP credentials. Logs are
 * the most common way those escape, so redaction is applied on the way *out* of
 * the logger rather than being left to each call site to remember.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Key names whose values are always replaced, matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|apikey|authorization|auth|credential|cookie|session|private[-_]?key|access[-_]?key|refresh[-_]?token|client[-_]?secret|signature|encryption[-_]?key|dsn|connection[-_]?string|database[-_]?url)/i;

/** Value shapes that are secret-like regardless of the key they arrived under. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi,
  /\bredis(?:s)?:\/\/[^\s"']+/gi,
];

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_STRING = 4000;

function redactString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/**
 * Deep-redact a log payload. Handles cycles, caps depth, and never throws —
 * a logger that can crash the request it is describing is worse than no logger.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return value.toString();

  if (depth >= MAX_DEPTH) return '[max depth]';

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      ...(value.cause !== undefined ? { cause: redact(value.cause, depth + 1, seen) } : {}),
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => redact(item, depth + 1, seen));
    }
    if (value instanceof Map) {
      return redact(Object.fromEntries(value), depth + 1, seen);
    }
    if (value instanceof Set) {
      return redact([...value], depth + 1, seen);
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1, seen);
    }
    return out;
  }

  return '[unserializable]';
}

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that stamps every record with additional context. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** `json` in production for log aggregation; `pretty` for a human terminal. */
  readonly format?: 'json' | 'pretty';
  readonly bindings?: LogFields;
  /** Injectable for tests. */
  readonly sink?: (line: string, level: LogLevel) => void;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: '\u001b[90m',
  debug: '\u001b[36m',
  info: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};
const RESET = '\u001b[0m';
const DIM = '\u001b[2m';

function defaultSink(line: string, level: LogLevel): void {
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const format = options.format ?? (process.env.NODE_ENV === 'production' ? 'json' : 'pretty');
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;
  const threshold = LEVEL_ORDER[level];

  function emit(recordLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[recordLevel] < threshold) return;

    const merged = { ...bindings, ...(fields ?? {}) };
    const safeFields = redact(merged) as Record<string, unknown>;
    const safeMessage = redactString(message);
    const time = new Date().toISOString();

    if (format === 'json') {
      let line: string;
      try {
        line = JSON.stringify({ time, level: recordLevel, msg: safeMessage, ...safeFields });
      } catch {
        line = JSON.stringify({ time, level: recordLevel, msg: safeMessage, fields: '[unserializable]' });
      }
      sink(line, recordLevel);
      return;
    }

    const color = LEVEL_COLOR[recordLevel];
    const head = `${DIM}${time.slice(11, 23)}${RESET} ${color}${recordLevel.toUpperCase().padEnd(5)}${RESET} ${safeMessage}`;
    const keys = Object.keys(safeFields);
    if (keys.length === 0) {
      sink(head, recordLevel);
      return;
    }
    let tail: string;
    try {
      tail = keys
        .map((k) => {
          const v = safeFields[k];
          const rendered = typeof v === 'string' ? v : JSON.stringify(v);
          return `${DIM}${k}${RESET}=${rendered}`;
        })
        .join(' ');
    } catch {
      tail = '[unserializable fields]';
    }
    sink(`${head} ${tail}`, recordLevel);
  }

  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) =>
      createLogger({
        ...options,
        level,
        format,
        bindings: { ...bindings, ...extra },
        ...(options.sink ? { sink: options.sink } : {}),
      }),
  };
}

/** Process-wide default. Prefer a `child()` carrying requestId / userId / workspaceId. */
export const logger: Logger = createLogger({
  level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
});
