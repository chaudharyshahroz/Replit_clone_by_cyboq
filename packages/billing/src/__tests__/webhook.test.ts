import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  HANDLED_EVENTS,
  MAX_TIMESTAMP_SKEW_SECONDS,
  computeSignature,
  isHandledEvent,
  parseEvent,
  signedPayload,
  verifyWebhook,
} from '../webhook';

const SECRET = 'ws_dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LXZhbHVl';
const ID = 'msg_abc123';
const BODY = JSON.stringify({ type: 'membership.activated', data: { id: 'mem_1' } });

const nowSeconds = (): string => String(Math.floor(Date.now() / 1000));

const sign = (overrides: { secret?: string; id?: string; timestamp?: string; body?: string } = {}) =>
  computeSignature({
    secret: overrides.secret ?? SECRET,
    id: overrides.id ?? ID,
    timestamp: overrides.timestamp ?? nowSeconds(),
    rawBody: overrides.body ?? BODY,
  });

const verify = (overrides: {
  secret?: string | undefined;
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
  body?: string;
  now?: Date;
} = {}) => {
  const timestamp = overrides.timestamp === undefined ? nowSeconds() : overrides.timestamp;
  return verifyWebhook({
    secret: 'secret' in overrides ? overrides.secret : SECRET,
    headers: {
      id: overrides.id === undefined ? ID : overrides.id,
      timestamp,
      signature:
        overrides.signature === undefined
          ? `v1,${sign({ timestamp: timestamp ?? undefined, body: overrides.body })}`
          : overrides.signature,
    },
    rawBody: overrides.body ?? BODY,
    ...(overrides.now ? { now: overrides.now } : {}),
  });
};

describe('signedPayload', () => {
  /** Whop signs `{id}.{timestamp}.{body}` — a different order verifies nothing. */
  it('is id.timestamp.body', () => {
    expect(signedPayload('a', '123', '{}')).toBe('a.123.{}');
  });
});

describe('verifyWebhook', () => {
  it('accepts a correctly signed delivery', () => {
    const result = verify();
    expect(result.valid).toBe(true);
  });

  /**
   * The attack this function exists to stop: anyone who can reach the endpoint
   * posting JSON that grants themselves a paid plan.
   */
  it('rejects an unsigned request', () => {
    const result = verifyWebhook({
      secret: SECRET,
      headers: { id: ID, timestamp: nowSeconds(), signature: null },
      rawBody: BODY,
    });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('missing_headers');
  });

  it('rejects a forged signature', () => {
    const result = verify({ signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('bad_signature');
  });

  it('rejects a signature made with the wrong secret', () => {
    const timestamp = nowSeconds();
    const result = verifyWebhook({
      secret: SECRET,
      headers: {
        id: ID,
        timestamp,
        signature: `v1,${sign({ secret: 'ws_d3Jvbmctc2VjcmV0', timestamp })}`,
      },
      rawBody: BODY,
    });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('bad_signature');
  });

  /**
   * The body is what carries the membership change, so a signature that stays
   * valid when the body changes is worthless.
   */
  it('rejects a tampered body', () => {
    const timestamp = nowSeconds();
    const result = verifyWebhook({
      secret: SECRET,
      headers: { id: ID, timestamp, signature: `v1,${sign({ timestamp })}` },
      rawBody: JSON.stringify({ type: 'membership.activated', data: { id: 'mem_ATTACKER' } }),
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a swapped webhook id', () => {
    const timestamp = nowSeconds();
    const result = verifyWebhook({
      secret: SECRET,
      headers: { id: 'msg_other', timestamp, signature: `v1,${sign({ timestamp })}` },
      rawBody: BODY,
    });
    expect(result.valid).toBe(false);
  });

  // Without a timestamp bound, one captured request replays forever.
  it('rejects a stale delivery', () => {
    const old = String(Math.floor(Date.now() / 1000) - MAX_TIMESTAMP_SKEW_SECONDS - 60);
    const result = verify({ timestamp: old });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('stale_timestamp');
  });

  /**
   * Bounded in both directions: only bounding the past would leave a forged
   * future timestamp valid indefinitely.
   */
  it('rejects a delivery from the future', () => {
    const future = String(Math.floor(Date.now() / 1000) + MAX_TIMESTAMP_SKEW_SECONDS + 60);
    const result = verify({ timestamp: future });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('stale_timestamp');
  });

  it('accepts a delivery just inside the window', () => {
    const recent = String(Math.floor(Date.now() / 1000) - (MAX_TIMESTAMP_SKEW_SECONDS - 10));
    expect(verify({ timestamp: recent }).valid).toBe(true);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(verify({ timestamp: 'yesterday' }).failure).toBe('malformed_signature');
  });

  /** Several signatures may be offered while a secret is being rotated. */
  it('accepts when one of several signatures matches', () => {
    const timestamp = nowSeconds();
    const result = verifyWebhook({
      secret: SECRET,
      headers: {
        id: ID,
        timestamp,
        signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1,${sign({ timestamp })}`,
      },
      rawBody: BODY,
    });
    expect(result.valid).toBe(true);
  });

  // An unimplemented version must not be guessed at.
  it('ignores signature versions it does not implement', () => {
    const result = verify({ signature: 'v2,anything' });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('malformed_signature');
  });

  it('reports missing configuration distinctly from a bad signature', () => {
    const result = verify({ secret: undefined });
    expect(result.failure).toBe('not_configured');
    expect(result.reason).toMatch(/WHOP_WEBHOOK_SECRET/);
  });

  // The reason is logged, so it must never carry the secret or the signature.
  it('never leaks the secret or the signature in its reason', () => {
    for (const result of [
      verify({ signature: 'v1,AAAA' }),
      verify({ timestamp: '1' }),
      verify({ secret: undefined }),
      verify({ id: null }),
    ]) {
      expect(result.reason).not.toContain(SECRET);
      expect(result.reason).not.toContain('AAAA');
    }
  });

  it('is stable across repeated verification of the same delivery', () => {
    const timestamp = nowSeconds();
    const signature = `v1,${sign({ timestamp })}`;
    const once = verifyWebhook({ secret: SECRET, headers: { id: ID, timestamp, signature }, rawBody: BODY });
    const twice = verifyWebhook({ secret: SECRET, headers: { id: ID, timestamp, signature }, rawBody: BODY });
    expect(once.valid && twice.valid).toBe(true);
  });

  /**
   * The prefix is presentation, not key material. Signing the prefixed string
   * would produce a signature that never matches — the sort of failure that
   * gets "fixed" by turning verification off.
   */
  it('treats prefixed and unprefixed secrets as the same key', () => {
    const timestamp = nowSeconds();
    const body = BODY;
    const withPrefix = computeSignature({ secret: 'ws_c2VjcmV0', id: ID, timestamp, rawBody: body });
    const without = computeSignature({ secret: 'c2VjcmV0', id: ID, timestamp, rawBody: body });
    expect(withPrefix).toBe(without);
  });

  it('matches an independently computed HMAC', () => {
    const timestamp = '1700000000';
    const expected = createHmac('sha256', Buffer.from('c2VjcmV0', 'base64'))
      .update(`${ID}.${timestamp}.${BODY}`)
      .digest('base64');

    expect(computeSignature({ secret: 'ws_c2VjcmV0', id: ID, timestamp, rawBody: BODY })).toBe(
      expected,
    );
  });
});

describe('parseEvent', () => {
  it('reads a standard envelope', () => {
    expect(parseEvent(BODY)).toEqual({
      type: 'membership.activated',
      data: { id: 'mem_1' },
    });
  });

  // Whop payloads have used several envelope keys over time.
  it.each(['type', 'action', 'event'])('accepts %s as the type key', (key) => {
    const raw = JSON.stringify({ [key]: 'payment.succeeded', data: { id: 'pay_1' } });
    expect(parseEvent(raw)?.type).toBe('payment.succeeded');
  });

  it('defaults data to an empty object', () => {
    expect(parseEvent(JSON.stringify({ type: 'payment.succeeded' }))?.data).toEqual({});
  });

  /** An event Reklu cannot name is one it must not act on. */
  it.each([
    ['no type', '{"data":{}}'],
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['null', 'null'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(parseEvent(raw)).toBeUndefined();
  });
});

describe('isHandledEvent', () => {
  it.each(HANDLED_EVENTS)('handles %s', (event) => {
    expect(isHandledEvent(event)).toBe(true);
  });

  // Acknowledged and ignored, not acted on.
  it.each(['membership.trial_ending_soon', 'payment.pending', 'something.new'])(
    'does not handle %s',
    (event) => {
      expect(isHandledEvent(event)).toBe(false);
    },
  );
});
