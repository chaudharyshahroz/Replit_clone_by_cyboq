import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetServerEnvCache } from '@reklu/shared';
import {
  SignInStateError,
  completeSignIn,
  deriveCodeChallenge,
  safeReturnTo,
  startSignIn,
} from '../oauth/state';

const key = () => randomBytes(32).toString('base64');

beforeEach(() => {
  resetServerEnvCache();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'https://reklu.app',
    DATABASE_URL: 'postgresql://postgres@localhost:5432/reklu',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: key(),
    ENCRYPTION_KEY: key(),
  });
});

describe('safeReturnTo', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeReturnTo('/projects/prj_1')).toBe('/projects/prj_1');
  });

  /**
   * `returnTo` is attacker-influencable. Without this, a crafted sign-in link
   * turns the callback into an open redirect wearing Reklu's domain — which is
   * exactly what makes a phishing page credible.
   */
  it.each([
    ['absolute url', 'https://evil.test/steal'],
    ['protocol-relative', '//evil.test'],
    ['backslash trick', '/\\evil.test'],
    ['crlf injection', '/home\r\nSet-Cookie: x=1'],
    ['empty', ''],
  ])('refuses %s', (_label, candidate) => {
    expect(safeReturnTo(candidate)).toBe('/home');
  });

  // Returning to the sign-in page after signing in would loop.
  it.each(['/login', '/signup', '/login?next=/home'])('refuses %s', (candidate) => {
    expect(safeReturnTo(candidate)).toBe('/home');
  });
});

describe('sign-in state', () => {
  it('round-trips a flow started in the same browser', () => {
    const started = startSignIn('google', '/projects');
    const completed = completeSignIn({
      state: started.state,
      cookieValue: started.cookieValue,
      provider: 'google',
    });

    expect(completed.provider).toBe('google');
    expect(completed.returnTo).toBe('/projects');
    expect(completed.codeVerifier).toBeTruthy();
  });

  it('derives a PKCE challenge from the verifier, not the other way round', () => {
    const started = startSignIn('google', '/home');
    const completed = completeSignIn({
      state: started.state,
      cookieValue: started.cookieValue,
      provider: 'google',
    });
    expect(deriveCodeChallenge(completed.codeVerifier)).toBe(started.codeChallenge);
  });

  // The verifier must never leave this server; only the challenge is sent.
  it('never puts the code verifier in the state', () => {
    const started = startSignIn('google', '/home');
    const verifier = started.cookieValue.split('.')[1]!;
    expect(started.state).not.toContain(verifier);
    expect(started.codeChallenge).not.toBe(verifier);
  });

  /**
   * The CSRF case. The state is genuinely Reklu's — it decrypts — but it was
   * issued to a different browser. Accepting it would let an attacker complete
   * a sign-in in the victim's session using the attacker's own code.
   */
  it('refuses a state that was not issued to this browser', () => {
    const attacker = startSignIn('google', '/home');
    const victim = startSignIn('google', '/home');

    expect(() =>
      completeSignIn({
        state: attacker.state,
        cookieValue: victim.cookieValue,
        provider: 'google',
      }),
    ).toThrow(/does not match this browser session/);
  });

  it('refuses a missing cookie', () => {
    const started = startSignIn('github', '/home');
    expect(() =>
      completeSignIn({ state: started.state, cookieValue: undefined, provider: 'github' }),
    ).toThrow(SignInStateError);
  });

  it('refuses a missing state', () => {
    const started = startSignIn('github', '/home');
    expect(() =>
      completeSignIn({ state: null, cookieValue: started.cookieValue, provider: 'github' }),
    ).toThrow(SignInStateError);
  });

  it('refuses a tampered state', () => {
    const started = startSignIn('github', '/home');
    const tampered = `${started.state.slice(0, -4)}AAAA`;
    expect(() =>
      completeSignIn({ state: tampered, cookieValue: started.cookieValue, provider: 'github' }),
    ).toThrow(/invalid/);
  });

  // A state issued for one provider must not complete another's callback.
  it('refuses a state from a different provider', () => {
    const started = startSignIn('google', '/home');
    expect(() =>
      completeSignIn({
        state: started.state,
        cookieValue: started.cookieValue,
        provider: 'github',
      }),
    ).toThrow(/different provider/);
  });

  it('refuses an expired state', () => {
    const started = startSignIn('google', '/home');
    expect(() =>
      completeSignIn({
        state: started.state,
        cookieValue: started.cookieValue,
        provider: 'google',
        now: Date.now() + 11 * 60 * 1000,
      }),
    ).toThrow(/expired/);
  });

  it('refuses a state stamped in the future', () => {
    const started = startSignIn('google', '/home');
    expect(() =>
      completeSignIn({
        state: started.state,
        cookieValue: started.cookieValue,
        provider: 'google',
        now: Date.now() - 5 * 60 * 1000,
      }),
    ).toThrow(/not yet valid/);
  });

  it('refuses a malformed cookie', () => {
    const started = startSignIn('google', '/home');
    expect(() =>
      completeSignIn({
        state: started.state,
        cookieValue: 'no-separator',
        provider: 'google',
      }),
    ).toThrow(/malformed/);
  });

  // An open-redirect smuggled through the state must be caught on the way out
  // too, not only when the flow starts.
  it('sanitises returnTo again on completion', () => {
    const started = startSignIn('google', 'https://evil.test');
    const completed = completeSignIn({
      state: started.state,
      cookieValue: started.cookieValue,
      provider: 'google',
    });
    expect(completed.returnTo).toBe('/home');
  });
});
