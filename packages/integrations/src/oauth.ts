/**
 * OAuth 2.0 authorization-code flow primitives.
 *
 * Two things go wrong in hand-rolled OAuth, and both are handled here rather
 * than in each route handler:
 *
 *   1. **CSRF.** Without a bound, single-use `state`, an attacker can hand a
 *      victim a callback URL carrying the attacker's authorization code, and
 *      the victim's workspace ends up connected to the attacker's account.
 *      The state is AEAD-encrypted (so it cannot be forged or read), carries a
 *      nonce that must match an httpOnly cookie set at the same moment, and
 *      expires.
 *
 *   2. **Code interception.** PKCE binds the exchange to a secret that never
 *      left this server, so a stolen authorization code is not enough.
 *
 * The verifier lives in the cookie, not in the state: the state travels to the
 * provider and back, and there is no reason to send the verifier on a round
 * trip through a third party even encrypted.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSecretBox, loadServerEnv, randomToken } from '@reklu/shared';
import type { IntegrationProviderKey } from './types';

/** AAD binding: an OAuth state can never be decrypted as anything else. */
const STATE_AAD = 'oauth:state';

/** Authorization must complete promptly; a stale state is a replay. */
const STATE_TTL_MS = 10 * 60 * 1000;

export const OAUTH_COOKIE_PREFIX = 'reklu_oauth_';

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

interface StatePayload {
  readonly p: IntegrationProviderKey;
  readonly w: string;
  readonly u: string;
  readonly n: string;
  readonly r: string;
  readonly t: number;
}

export interface StartedFlow {
  /** Goes in the authorize URL. Opaque to the provider. */
  readonly state: string;
  /** Goes in an httpOnly, SameSite=Lax cookie on the same response. */
  readonly cookieName: string;
  readonly cookieValue: string;
  /** Send to the provider; the verifier stays in the cookie. */
  readonly codeChallenge: string;
  readonly codeVerifier: string;
}

export interface FlowContext {
  readonly provider: IntegrationProviderKey;
  readonly workspaceId: string;
  readonly userId: string;
  /** Where to send the user once the connection is stored. */
  readonly returnTo: string;
}

function box() {
  const env = loadServerEnv();
  return createSecretBox({
    key: env.ENCRYPTION_KEY,
    previousKey: env.ENCRYPTION_KEY_PREVIOUS,
  });
}

/** RFC 7636 S256. */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * `returnTo` is attacker-influencable, so it is constrained to a path on this
 * origin. Without this, a crafted start URL turns the callback into an open
 * redirect that laundered Reklu's domain.
 */
export function safeReturnTo(candidate: string | undefined | null): string {
  if (!candidate) return '/settings/connections';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/settings/connections';
  if (candidate.includes('\\') || /[\r\n]/.test(candidate)) return '/settings/connections';
  return candidate;
}

export function startFlow(context: FlowContext): StartedFlow {
  const nonce = randomToken(32);
  const codeVerifier = randomBytes(32).toString('base64url');

  const payload: StatePayload = {
    p: context.provider,
    w: context.workspaceId,
    u: context.userId,
    n: nonce,
    r: safeReturnTo(context.returnTo),
    t: Date.now(),
  };

  return {
    state: box().encrypt(JSON.stringify(payload), STATE_AAD),
    cookieName: `${OAUTH_COOKIE_PREFIX}${context.provider}`,
    // Both secrets in one cookie; neither is ever sent to the provider.
    cookieValue: `${nonce}.${codeVerifier}`,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    codeVerifier,
  };
}

export interface CompletedFlow extends FlowContext {
  readonly codeVerifier: string;
}

/**
 * Validate a callback's `state` against the cookie set when the flow started.
 *
 * Throws on every failure rather than returning a result, because there is no
 * safe way to continue a flow whose origin cannot be established.
 */
export function completeFlow(params: {
  state: string | undefined | null;
  cookieValue: string | undefined | null;
  provider: IntegrationProviderKey;
  now?: number;
}): CompletedFlow {
  if (!params.state) throw new OAuthStateError('The authorization response carried no state.');
  if (!params.cookieValue) {
    throw new OAuthStateError(
      'The authorization session has expired or cookies are blocked. Start the connection again.',
    );
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(box().decrypt(params.state, STATE_AAD)) as StatePayload;
  } catch {
    // Covers tampering, a foreign state, and a state encrypted under a key this
    // deployment does not hold. None is recoverable.
    throw new OAuthStateError('The authorization state is invalid.');
  }

  const [nonce, codeVerifier] = params.cookieValue.split('.');
  if (!nonce || !codeVerifier) throw new OAuthStateError('The authorization cookie is malformed.');

  if (!constantTimeEquals(payload.n, nonce)) {
    // The state decrypted, so it is genuinely ours — but it was not issued to
    // this browser. That is the CSRF case.
    throw new OAuthStateError('The authorization state does not match this browser session.');
  }

  if (payload.p !== params.provider) {
    throw new OAuthStateError('The authorization state belongs to a different provider.');
  }

  const now = params.now ?? Date.now();
  if (now - payload.t > STATE_TTL_MS) {
    throw new OAuthStateError('The authorization request expired. Start the connection again.');
  }
  // A state stamped in the future is a clock problem or a forgery attempt.
  if (payload.t - now > 60_000) {
    throw new OAuthStateError('The authorization state is not yet valid.');
  }

  return {
    provider: payload.p,
    workspaceId: payload.w,
    userId: payload.u,
    returnTo: safeReturnTo(payload.r),
    codeVerifier,
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
