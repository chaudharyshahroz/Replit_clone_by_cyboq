/**
 * CSRF state for sign-in flows.
 *
 * Same shape as the integrations flow, with one difference that matters: there
 * is no signed-in user yet, so the state cannot be bound to a session. The
 * binding is the nonce-plus-cookie pair alone, which is exactly what stops an
 * attacker handing someone a callback URL carrying their own authorization
 * code and having the victim's browser complete it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSecretBox, loadServerEnv, randomToken } from '@reklu/shared';
import type { SignInProviderKey } from './providers';

const STATE_AAD = 'auth:signin:state';
const STATE_TTL_MS = 10 * 60 * 1000;
export const SIGN_IN_COOKIE_PREFIX = 'reklu_signin_';

export class SignInStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInStateError';
  }
}

interface StatePayload {
  readonly p: SignInProviderKey;
  readonly n: string;
  readonly r: string;
  readonly t: number;
}

function box() {
  const env = loadServerEnv();
  return createSecretBox({ key: env.AUTH_SECRET, previousKey: undefined });
}

export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Constrained to a path on this origin, so the callback cannot open-redirect. */
export function safeReturnTo(candidate: string | undefined | null): string {
  if (!candidate) return '/chat';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/chat';
  if (candidate.includes('\\') || /[\r\n]/.test(candidate)) return '/chat';
  // An authenticated destination only; bouncing back to /login would loop.
  if (candidate.startsWith('/login') || candidate.startsWith('/signup')) return '/chat';
  return candidate;
}

export interface StartedSignIn {
  readonly state: string;
  readonly cookieName: string;
  readonly cookieValue: string;
  readonly codeChallenge: string;
}

export function startSignIn(provider: SignInProviderKey, returnTo: string): StartedSignIn {
  const nonce = randomToken(32);
  const codeVerifier = randomBytes(32).toString('base64url');

  const payload: StatePayload = {
    p: provider,
    n: nonce,
    r: safeReturnTo(returnTo),
    t: Date.now(),
  };

  return {
    state: box().encrypt(JSON.stringify(payload), STATE_AAD),
    cookieName: `${SIGN_IN_COOKIE_PREFIX}${provider}`,
    cookieValue: `${nonce}.${codeVerifier}`,
    codeChallenge: deriveCodeChallenge(codeVerifier),
  };
}

export interface CompletedSignIn {
  readonly provider: SignInProviderKey;
  readonly returnTo: string;
  readonly codeVerifier: string;
}

export function completeSignIn(params: {
  state: string | undefined | null;
  cookieValue: string | undefined | null;
  provider: SignInProviderKey;
  now?: number;
}): CompletedSignIn {
  if (!params.state) throw new SignInStateError('The sign-in response carried no state.');
  if (!params.cookieValue) {
    throw new SignInStateError(
      'The sign-in session expired or cookies are blocked. Try signing in again.',
    );
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(box().decrypt(params.state, STATE_AAD)) as StatePayload;
  } catch {
    throw new SignInStateError('The sign-in state is invalid.');
  }

  const [nonce, codeVerifier] = params.cookieValue.split('.');
  if (!nonce || !codeVerifier) throw new SignInStateError('The sign-in cookie is malformed.');

  // The state decrypted, so it is genuinely ours — but it was not issued to
  // this browser. That is the CSRF case.
  if (!constantTimeEquals(payload.n, nonce)) {
    throw new SignInStateError('The sign-in state does not match this browser session.');
  }
  if (payload.p !== params.provider) {
    throw new SignInStateError('The sign-in state belongs to a different provider.');
  }

  const now = params.now ?? Date.now();
  if (now - payload.t > STATE_TTL_MS) {
    throw new SignInStateError('The sign-in request expired. Try again.');
  }
  if (payload.t - now > 60_000) {
    throw new SignInStateError('The sign-in state is not yet valid.');
  }

  return { provider: payload.p, returnTo: safeReturnTo(payload.r), codeVerifier };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
