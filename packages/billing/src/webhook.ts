/**
 * Verifying Whop webhooks (spec §72–§75).
 *
 * This is the highest-consequence function in the billing system. A webhook
 * says "this workspace now has a Pro membership", and Reklu acts on it. If the
 * signature check is wrong, anyone who can reach the endpoint can grant
 * themselves a paid plan by posting JSON at it.
 *
 * Whop implements the Standard Webhooks scheme:
 *
 *   headers    webhook-id, webhook-timestamp, webhook-signature
 *   algorithm  HMAC-SHA256
 *   signed     `{webhook-id}.{webhook-timestamp}.{raw body}`
 *   secret     the `ws_...` value, base64 after the `whsec_`/`ws_` prefix
 *   header     `v1,<base64>` — possibly several, space separated, during
 *              secret rotation
 *
 * Three properties matter and all three are enforced here:
 *
 *   1. The signature is over the **raw body**. Re-serialising parsed JSON
 *      changes bytes and would either break every request or, worse, tempt
 *      someone to verify a re-serialised string that an attacker controls.
 *   2. Comparison is constant time. A byte-by-byte early return leaks the
 *      expected signature to anyone willing to measure.
 *   3. Old requests are rejected. Without a timestamp bound, a single captured
 *      request can be replayed forever.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Whop's documented tolerance. Beyond this a request is a replay. */
export const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export type VerificationFailure =
  | 'missing_headers'
  | 'malformed_signature'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'not_configured';

export interface VerificationResult {
  readonly valid: boolean;
  readonly failure?: VerificationFailure | undefined;
  /** Safe to log. Never contains the signature or the secret. */
  readonly reason: string;
}

export interface WebhookHeaders {
  readonly id: string | null | undefined;
  readonly timestamp: string | null | undefined;
  readonly signature: string | null | undefined;
}

/**
 * The signing key.
 *
 * Whop presents the secret with a prefix; the bytes that sign are what follows
 * it, base64-decoded. Signing the prefixed string would produce a signature
 * that never matches, which is the kind of failure that gets "fixed" by
 * disabling verification.
 */
function signingKey(secret: string): Buffer {
  const trimmed = secret.trim();
  const withoutPrefix = trimmed.replace(/^(whsec_|ws_)/, '');
  const decoded = Buffer.from(withoutPrefix, 'base64');
  // A secret that is not valid base64 is used verbatim rather than silently
  // becoming an empty key, which would verify nothing and appear to work.
  return decoded.length > 0 ? decoded : Buffer.from(trimmed, 'utf8');
}

/** The exact string Whop signs. */
export function signedPayload(id: string, timestamp: string, rawBody: string): string {
  return `${id}.${timestamp}.${rawBody}`;
}

export function computeSignature(params: {
  secret: string;
  id: string;
  timestamp: string;
  rawBody: string;
}): string {
  return createHmac('sha256', signingKey(params.secret))
    .update(signedPayload(params.id, params.timestamp, params.rawBody))
    .digest('base64');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // Lengths differ: comparing anyway would throw, and returning early on
  // length is not a meaningful leak — the length is in the header already.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a delivery.
 *
 * Returns a result rather than throwing, so the caller can log the reason and
 * still answer 4xx — an exception here would be indistinguishable from a bug.
 */
export function verifyWebhook(params: {
  secret: string | undefined;
  headers: WebhookHeaders;
  rawBody: string;
  now?: Date;
}): VerificationResult {
  if (!params.secret) {
    return {
      valid: false,
      failure: 'not_configured',
      reason: 'WHOP_WEBHOOK_SECRET is not set, so deliveries cannot be verified.',
    };
  }

  const { id, timestamp, signature } = params.headers;
  if (!id || !timestamp || !signature) {
    return {
      valid: false,
      failure: 'missing_headers',
      reason: 'The request is missing webhook-id, webhook-timestamp or webhook-signature.',
    };
  }

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) {
    return {
      valid: false,
      failure: 'malformed_signature',
      reason: 'The webhook-timestamp header is not a unix timestamp.',
    };
  }

  /**
   * Replay protection. Checked in both directions: a timestamp far in the
   * future is as suspicious as one far in the past, and only bounding the past
   * would let a forged future timestamp stay valid indefinitely.
   */
  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return {
      valid: false,
      failure: 'stale_timestamp',
      reason: `The delivery timestamp is outside the ${MAX_TIMESTAMP_SKEW_SECONDS}s window.`,
    };
  }

  const expected = computeSignature({
    secret: params.secret,
    id,
    timestamp,
    rawBody: params.rawBody,
  });

  /**
   * The header may carry several signatures, space separated, so a secret can
   * be rotated without dropping deliveries. Any one matching is enough;
   * entries without the `v1,` prefix are versions this code does not implement
   * and are ignored rather than guessed at.
   */
  const offered = signature
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => entry.slice(3));

  if (offered.length === 0) {
    return {
      valid: false,
      failure: 'malformed_signature',
      reason: 'No v1 signature was present in webhook-signature.',
    };
  }

  const matched = offered.some((candidate) => constantTimeEquals(candidate, expected));

  return matched
    ? { valid: true, reason: 'Signature verified.' }
    : {
        valid: false,
        failure: 'bad_signature',
        reason: 'The signature does not match the request body.',
      };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Events Reklu acts on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  'membership.activated',
  'membership.deactivated',
  'membership.cancel_at_period_end_changed',
  'payment.succeeded',
  'payment.failed',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export interface WhopEvent {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export function isHandledEvent(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/**
 * Read an event out of a delivery body.
 *
 * Deliberately tolerant about envelope shape — `action`/`event`/`type` have all
 * appeared in Whop payloads over time — and strict about there being a type at
 * all, since an event Reklu cannot name is one it must not act on.
 */
export function parseEvent(rawBody: string): WhopEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object') return undefined;
  const envelope = parsed as Record<string, unknown>;

  const type =
    (typeof envelope.type === 'string' && envelope.type) ||
    (typeof envelope.action === 'string' && envelope.action) ||
    (typeof envelope.event === 'string' && envelope.event);

  if (!type) return undefined;

  const data =
    envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : {};

  return { type, data };
}
