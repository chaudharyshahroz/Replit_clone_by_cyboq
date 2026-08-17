/**
 * Identity providers for sign-in (spec §11).
 *
 * Deliberately separate from `@reklu/integrations`, which connects a user's
 * GitHub or Vercel *account* so Reklu can act on their repositories. These are
 * different OAuth applications with different scopes, and the tokens live in
 * different tables. A sign-in token must never be usable to push code, and the
 * only way to guarantee that is to never let the two share a path.
 *
 * Sign-in asks for the narrowest possible scopes: who you are, and an email
 * address Reklu can trust.
 */
import { z } from 'zod';

export const SIGN_IN_PROVIDERS = ['google', 'github'] as const;
export type SignInProviderKey = (typeof SIGN_IN_PROVIDERS)[number];

export function isSignInProvider(value: string): value is SignInProviderKey {
  return (SIGN_IN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * A verified identity from a provider.
 *
 * `emailVerified` is the field the whole security model turns on. See
 * `signin.ts`: an unverified address must never be allowed to claim an
 * existing Reklu account.
 */
export interface OAuthIdentity {
  readonly providerAccountId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name?: string | undefined;
  readonly avatarUrl?: string | undefined;
}

export interface SignInProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface SignInProvider {
  readonly key: SignInProviderKey;
  readonly displayName: string;
  readonly requiredEnv: readonly [clientId: string, clientSecret: string];
  authorizeUrl(params: {
    credentials: SignInProviderCredentials;
    state: string;
    codeChallenge?: string | undefined;
  }): string;
  exchange(params: {
    credentials: SignInProviderCredentials;
    code: string;
    codeVerifier?: string | undefined;
  }): Promise<OAuthIdentity>;
}

export class SignInProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInProviderError';
  }
}

const TIMEOUT_MS = 15_000;

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SignInProviderError(
      `Could not reach the identity provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // The body is never included: token responses carry credentials even on error.
  if (!response.ok) {
    throw new SignInProviderError(`The identity provider rejected the sign-in (HTTP ${response.status}).`);
  }
  const parsed = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!parsed) throw new SignInProviderError('The identity provider returned a malformed response.');
  if (typeof parsed.error === 'string') {
    throw new SignInProviderError('The identity provider refused the sign-in.');
  }
  return parsed;
}

async function getJson<T>(url: string, accessToken: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'Reklu/0.1 (+https://reklu.app)',
      ...headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SignInProviderError(`The identity provider returned HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/**
 * Google returns the identity in an ID token. Rather than verify a JWT
 * signature by hand, the profile is fetched from the userinfo endpoint using
 * the access token Google just issued to us over TLS — which carries the same
 * assurance without a homegrown verifier.
 */
const googleProfile = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export const googleSignInProvider: SignInProvider = {
  key: 'google',
  displayName: 'Google',
  requiredEnv: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'],

  authorizeUrl({ credentials, state, codeChallenge }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    // Forces the account chooser, so a shared browser cannot silently reuse
    // whichever Google account happens to be signed in.
    url.searchParams.set('prompt', 'select_account');
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  },

  async exchange({ credentials, code, codeVerifier }): Promise<OAuthIdentity> {
    const token = await postForm('https://oauth2.googleapis.com/token', {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: credentials.redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });

    const accessToken = String(token.access_token ?? '');
    if (!accessToken) throw new SignInProviderError('Google returned no access token.');

    const profile = googleProfile.parse(
      await getJson<unknown>('https://openidconnect.googleapis.com/v1/userinfo', accessToken),
    );

    return {
      providerAccountId: profile.sub,
      email: profile.email,
      // Google encodes this as a boolean or the strings "true"/"false".
      emailVerified: profile.email_verified === true || profile.email_verified === 'true',
      name: profile.name,
      avatarUrl: profile.picture,
    };
  },
};

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const githubUser = z.object({
  id: z.union([z.number(), z.string()]),
  login: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const githubEmails = z.array(
  z.object({
    email: z.string(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
);

export const githubSignInProvider: SignInProvider = {
  key: 'github',
  displayName: 'GitHub',
  requiredEnv: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'],

  authorizeUrl({ credentials, state }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    // Sign-in only. Notably NOT `repo` — that belongs to the integration app.
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchange({ credentials, code }): Promise<OAuthIdentity> {
    const token = await postForm('https://github.com/login/oauth/access_token', {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: credentials.redirectUri,
    });

    const accessToken = String(token.access_token ?? '');
    if (!accessToken) throw new SignInProviderError('GitHub returned no access token.');

    const user = githubUser.parse(await getJson<unknown>('https://api.github.com/user', accessToken));

    /**
     * `/user` returns only the *public* email, and never says whether it is
     * verified. `/user/emails` is the only source that does, so it is the only
     * one trusted — an unverified address must not be able to claim an
     * existing Reklu account.
     */
    const emails = githubEmails.parse(
      await getJson<unknown>('https://api.github.com/user/emails', accessToken),
    );
    const chosen =
      emails.find((entry) => entry.primary && entry.verified) ??
      emails.find((entry) => entry.verified);

    if (!chosen) {
      throw new SignInProviderError(
        'Your GitHub account has no verified email address. Verify one on GitHub, then try again.',
      );
    }

    return {
      providerAccountId: String(user.id),
      email: chosen.email,
      emailVerified: true,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url ?? undefined,
    };
  },
};

const PROVIDERS: Record<SignInProviderKey, SignInProvider> = {
  google: googleSignInProvider,
  github: githubSignInProvider,
};

export function getSignInProvider(key: SignInProviderKey): SignInProvider {
  return PROVIDERS[key];
}
