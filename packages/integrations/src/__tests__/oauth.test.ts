import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetServerEnvCache } from '@reklu/shared';
import {
  OAuthStateError,
  completeFlow,
  deriveCodeChallenge,
  safeReturnTo,
  startFlow,
} from '../oauth';
import { credentialsFor, describeProvider, redirectUriFor } from '../registry';
import { expiryFrom, parseScopes } from '../http';
import { githubProvider } from '../providers/github';
import { supabaseProvider } from '../providers/supabase';
import { isIntegrationProvider } from '../types';

const key = () => randomBytes(32).toString('base64');

function configure(extra: Record<string, string> = {}): void {
  resetServerEnvCache();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'https://reklu.app',
    DATABASE_URL: 'postgresql://postgres@localhost:5432/reklu',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: key(),
    ENCRYPTION_KEY: key(),
    OPENAI_API_KEY: 'sk-test',
    ...extra,
  });
}

const context = {
  provider: 'github' as const,
  workspaceId: 'ws_1',
  userId: 'usr_1',
  returnTo: '/settings/connections',
};

beforeEach(() => {
  configure();
  for (const name of [
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_OAUTH_REDIRECT_URI',
  ]) {
    delete process.env[name];
  }
  resetServerEnvCache();
});

describe('authorization flow state', () => {
  it('round-trips the context it was started with', () => {
    const started = startFlow(context);
    const completed = completeFlow({
      state: started.state,
      cookieValue: started.cookieValue,
      provider: 'github',
    });

    expect(completed.workspaceId).toBe('ws_1');
    expect(completed.userId).toBe('usr_1');
    expect(completed.codeVerifier).toBe(started.codeVerifier);
  });

  /**
   * The attack this exists to stop: an attacker sends the victim a callback URL
   * carrying the attacker's authorization code. Without the cookie binding, the
   * victim's workspace ends up connected to the attacker's account.
   */
  it('rejects a state that was not issued to this browser', () => {
    const victim = startFlow(context);
    const attacker = startFlow({ ...context, workspaceId: 'ws_attacker' });

    expect(() =>
      completeFlow({
        state: attacker.state,
        cookieValue: victim.cookieValue,
        provider: 'github',
      }),
    ).toThrow(/does not match this browser session/);
  });

  it('rejects a callback with no state at all', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({ state: undefined, cookieValue: started.cookieValue, provider: 'github' }),
    ).toThrow(OAuthStateError);
  });

  it('rejects a callback with no cookie', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({ state: started.state, cookieValue: undefined, provider: 'github' }),
    ).toThrow(/expired or cookies are blocked/);
  });

  it('rejects a tampered state', () => {
    const started = startFlow(context);
    const tampered = `${started.state.slice(0, -4)}AAAA`;
    expect(() =>
      completeFlow({ state: tampered, cookieValue: started.cookieValue, provider: 'github' }),
    ).toThrow(/invalid/);
  });

  // A state sealed under a different ENCRYPTION_KEY must not be accepted.
  it('rejects a state minted by another deployment', () => {
    const started = startFlow(context);
    configure();
    expect(() =>
      completeFlow({ state: started.state, cookieValue: started.cookieValue, provider: 'github' }),
    ).toThrow(/invalid/);
  });

  it('rejects a state replayed after it expired', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({
        state: started.state,
        cookieValue: started.cookieValue,
        provider: 'github',
        now: Date.now() + 11 * 60 * 1000,
      }),
    ).toThrow(/expired/);
  });

  it('rejects a state stamped in the future', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({
        state: started.state,
        cookieValue: started.cookieValue,
        provider: 'github',
        now: Date.now() - 5 * 60 * 1000,
      }),
    ).toThrow(/not yet valid/);
  });

  // Cross-provider replay: a GitHub state must not authorize a Vercel callback.
  it('rejects a state issued for a different provider', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({ state: started.state, cookieValue: started.cookieValue, provider: 'vercel' }),
    ).toThrow(/different provider/);
  });

  it('rejects a malformed cookie', () => {
    const started = startFlow(context);
    expect(() =>
      completeFlow({ state: started.state, cookieValue: 'nodot', provider: 'github' }),
    ).toThrow(/malformed/);
  });

  it('never puts the code verifier in the state', () => {
    const started = startFlow(context);
    expect(started.state).not.toContain(started.codeVerifier);
  });

  it('issues a distinct nonce and verifier per flow', () => {
    const a = startFlow(context);
    const b = startFlow(context);
    expect(a.cookieValue).not.toBe(b.cookieValue);
    expect(a.state).not.toBe(b.state);
  });
});

describe('safeReturnTo', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeReturnTo('/build/bld_123')).toBe('/build/bld_123');
  });

  /** Without this the callback is an open redirect wearing Reklu's domain. */
  it.each([
    ['absolute url', 'https://evil.example/steal'],
    ['protocol-relative', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['crlf injection', '/path\r\nSet-Cookie: x=1'],
    ['empty', ''],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/settings/connections');
  });

  it('sanitises on the way out as well as in', () => {
    const started = startFlow({ ...context, returnTo: 'https://evil.example' });
    const completed = completeFlow({
      state: started.state,
      cookieValue: started.cookieValue,
      provider: 'github',
    });
    expect(completed.returnTo).toBe('/settings/connections');
  });
});

describe('PKCE', () => {
  it('derives a URL-safe S256 challenge', () => {
    const challenge = deriveCodeChallenge('verifier');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain('=');
  });

  it('is deterministic for a verifier and differs between verifiers', () => {
    expect(deriveCodeChallenge('a')).toBe(deriveCodeChallenge('a'));
    expect(deriveCodeChallenge('a')).not.toBe(deriveCodeChallenge('b'));
  });

  it('sends the challenge to a PKCE provider and never the verifier', () => {
    const started = startFlow({ ...context, provider: 'supabase' });
    const url = supabaseProvider.authorizeUrl({
      credentials: { clientId: 'id', clientSecret: 's', redirectUri: 'https://reklu.app/cb' },
      state: started.state,
      codeChallenge: started.codeChallenge,
    });

    expect(url).toContain('code_challenge_method=S256');
    expect(url).not.toContain(started.codeVerifier);
  });
});

describe('provider configuration', () => {
  it('reports an unconfigured provider by variable name, not as unavailable', () => {
    const described = describeProvider('github');
    expect(described.configured).toBe(false);
    expect(described.missingEnv).toEqual(['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET']);
  });

  it('returns no credentials when only half the pair is set', () => {
    configure({ GITHUB_APP_CLIENT_ID: 'id' });
    expect(credentialsFor('github')).toBeUndefined();
  });

  it('reports configured once both are present', () => {
    configure({ GITHUB_APP_CLIENT_ID: 'id', GITHUB_APP_CLIENT_SECRET: 'secret' });
    expect(describeProvider('github').configured).toBe(true);
    expect(credentialsFor('github')?.clientId).toBe('id');
  });

  // One fewer variable to keep in sync across environments.
  it('derives the redirect URI from APP_URL by default', () => {
    expect(redirectUriFor('github')).toBe('https://reklu.app/api/integrations/github/callback');
  });

  it('prefers an explicitly configured redirect URI', () => {
    configure({ GITHUB_OAUTH_REDIRECT_URI: 'https://other.example/cb' });
    expect(redirectUriFor('github')).toBe('https://other.example/cb');
  });

  it('recognises only known providers', () => {
    expect(isIntegrationProvider('github')).toBe(true);
    expect(isIntegrationProvider('dropbox')).toBe(false);
  });
});

describe('github authorize url', () => {
  it('carries the state and the scopes it documents', () => {
    const url = new URL(
      githubProvider.authorizeUrl({
        credentials: {
          clientId: 'abc',
          clientSecret: 'shh',
          redirectUri: 'https://reklu.app/api/integrations/github/callback',
        },
        state: 'the-state',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('scope')).toContain('repo');
    // The client secret must never appear in a URL the browser follows.
    expect(url.toString()).not.toContain('shh');
  });

  it('documents every scope it requests', () => {
    const url = new URL(
      githubProvider.authorizeUrl({
        credentials: { clientId: 'a', clientSecret: 'b', redirectUri: 'https://reklu.app/cb' },
        state: 's',
      }),
    );
    for (const scope of (url.searchParams.get('scope') ?? '').split(' ')) {
      expect(githubProvider.scopeDescriptions[scope]).toBeDefined();
    }
  });
});

describe('token response parsing', () => {
  it('splits scopes on either separator providers use', () => {
    expect(parseScopes('repo read:user')).toEqual(['repo', 'read:user']);
    expect(parseScopes('repo,read:user')).toEqual(['repo', 'read:user']);
  });

  it('treats missing or empty scope as none granted', () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes('  ')).toEqual([]);
  });

  it('converts expires_in to an absolute time', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(expiryFrom(3600, now)?.toISOString()).toBe(new Date(now + 3_600_000).toISOString());
  });

  // A non-expiring token must not be recorded as already expired.
  it.each([undefined, 0, -1, 'nonsense'])('treats %s as non-expiring', (value) => {
    expect(expiryFrom(value)).toBeUndefined();
  });
});
