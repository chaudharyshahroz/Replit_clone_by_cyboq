/**
 * Connectors as data rather than as code.
 *
 * Four providers were four files, each repeating the same OAuth dance with a
 * different set of URLs. That is fine for four and hopeless for two hundred:
 * the ninety-fifth connector should not be the ninety-fifth code path, for the
 * same reason a model is a row in this codebase rather than a constant.
 *
 * So a connector is a descriptor, and one adapter serves all of them. Adding
 * one is adding an entry.
 *
 * What this does not remove — and cannot — is the credential. Every provider
 * requires an OAuth application registered with *them*, and the client id and
 * secret that come back belong to whoever runs this Reklu. A hosted assistant
 * registers those once as a company; a self-hosted one cannot inherit them.
 * That is the real cost of a connector, and it is not code.
 */
import { expiryFrom, getJson, parseScopes, postForToken, tokenWorks } from './http';
import type {
  AuthorizeParams,
  ExchangeParams,
  ExternalAccount,
  IntegrationProvider,
  TokenSet,
} from './types';

/**
 * Where the connected account's name comes from.
 *
 * Two shapes, because providers genuinely differ. Most answer a userinfo
 * endpoint. Slack and Notion return the identity inside the token response and
 * have no such endpoint — asking for one would be a request that 404s.
 */
export type IdentitySource =
  | { readonly from: 'endpoint'; readonly url: string; readonly idPath: string; readonly namePath: string; readonly avatarPath?: string }
  | { readonly from: 'token'; readonly idPath: string; readonly namePath: string; readonly avatarPath?: string };

export interface OAuthDescriptor {
  readonly key: string;
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  readonly scopeDescriptions: Readonly<Record<string, string>>;
  readonly usesPkce: boolean;
  /**
   * How the client secret is presented at the token endpoint.
   *
   * Most take it in the body. Notion requires HTTP Basic, and sending it in the
   * body there returns a 401 that says nothing about why.
   */
  readonly tokenAuth?: 'body' | 'basic';
  /** Extra authorize parameters a provider needs, such as Google's offline access. */
  readonly authorizeParams?: Readonly<Record<string, string>>;
  /** How scopes are joined. Google wants spaces; Slack and GitHub want commas. */
  readonly scopeSeparator?: string;
  readonly identity: IdentitySource;
  /** A cheap authenticated call, to confirm a stored token still works. */
  readonly verifyUrl?: string;
}

/** Read a dotted path out of a payload, because identity fields nest. */
function at(payload: unknown, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((current, key) => (current as Record<string, unknown>)?.[key], payload);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * The environment variables a catalogue provider needs.
 *
 * Derived from the key rather than declared, because the set of connectors is
 * data and a fixed schema cannot enumerate data. Read from `process.env`
 * directly for the same reason — the validated environment knows only the names
 * written into it.
 */
export function credentialEnvFor(key: string): readonly [string, string] {
  const prefix = key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return [`${prefix}_OAUTH_CLIENT_ID`, `${prefix}_OAUTH_CLIENT_SECRET`];
}

export function createOAuthProvider(descriptor: OAuthDescriptor): IntegrationProvider {
  const separator = descriptor.scopeSeparator ?? ' ';
  const [clientIdEnv, clientSecretEnv] = credentialEnvFor(descriptor.key);

  async function identify(accessToken: string, tokenPayload?: unknown): Promise<ExternalAccount> {
    const source =
      descriptor.identity.from === 'token'
        ? tokenPayload
        : await getJson<unknown>(descriptor.key, descriptor.identity.url, accessToken);

    const id = at(source, descriptor.identity.idPath);
    const name = at(source, descriptor.identity.namePath);
    const avatar = descriptor.identity.avatarPath
      ? at(source, descriptor.identity.avatarPath)
      : undefined;

    return {
      /* An account with no id cannot be deduplicated; the name is a better label than nothing. */
      id: id ?? name ?? descriptor.key,
      name: name ?? id ?? descriptor.displayName,
      ...(avatar ? { avatarUrl: avatar } : {}),
    };
  }

  return {
    key: descriptor.key as IntegrationProvider['key'],
    displayName: descriptor.displayName,
    requiredEnv: [clientIdEnv, clientSecretEnv],
    usesPkce: descriptor.usesPkce,
    scopeDescriptions: descriptor.scopeDescriptions,

    authorizeUrl({ credentials, state, codeChallenge }: AuthorizeParams): string {
      const url = new URL(descriptor.authorizeUrl);
      url.searchParams.set('client_id', credentials.clientId);
      url.searchParams.set('redirect_uri', credentials.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', descriptor.scopes.join(separator));
      url.searchParams.set('state', state);

      for (const [name, value] of Object.entries(descriptor.authorizeParams ?? {})) {
        url.searchParams.set(name, value);
      }

      if (codeChallenge && descriptor.usesPkce) {
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
      }

      return url.toString();
    },

    async exchangeCode({ credentials, code, codeVerifier }: ExchangeParams): Promise<TokenSet> {
      const basic = descriptor.tokenAuth === 'basic';

      const payload = await postForToken(
        descriptor.key,
        descriptor.tokenUrl,
        {
          redirect_uri: credentials.redirectUri,
          grant_type: 'authorization_code',
          code,
          ...(basic
            ? {}
            : { client_id: credentials.clientId, client_secret: credentials.clientSecret }),
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        },
        basic
          ? {
              Authorization: `Basic ${Buffer.from(
                `${credentials.clientId}:${credentials.clientSecret}`,
              ).toString('base64')}`,
            }
          : {},
      );

      /*
       * Kept so `identify` can read it. A provider that returns the account in
       * its token response has no endpoint to ask afterwards, and the payload
       * is the only place that name exists.
       */
      lastTokenPayload.set(String(payload['access_token'] ?? ''), payload);

      return {
        accessToken: String(payload['access_token'] ?? ''),
        refreshToken: payload['refresh_token'] ? String(payload['refresh_token']) : undefined,
        tokenType: String(payload['token_type'] ?? 'Bearer'),
        expiresAt: expiryFrom(payload['expires_in']),
        scopes: parseScopes(payload['scope']),
      };
    },

    async refresh({ credentials, refreshToken }): Promise<TokenSet> {
      const basic = descriptor.tokenAuth === 'basic';

      const payload = await postForToken(
        descriptor.key,
        descriptor.tokenUrl,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          ...(basic
            ? {}
            : { client_id: credentials.clientId, client_secret: credentials.clientSecret }),
        },
        basic
          ? {
              Authorization: `Basic ${Buffer.from(
                `${credentials.clientId}:${credentials.clientSecret}`,
              ).toString('base64')}`,
            }
          : {},
      );

      return {
        accessToken: String(payload['access_token'] ?? ''),
        /* Most providers do not repeat it; carrying it forward is what keeps the connection alive. */
        refreshToken: payload['refresh_token'] ? String(payload['refresh_token']) : refreshToken,
        tokenType: String(payload['token_type'] ?? 'Bearer'),
        expiresAt: expiryFrom(payload['expires_in']),
        scopes: parseScopes(payload['scope']),
      };
    },

    async identify(accessToken: string): Promise<ExternalAccount> {
      return identify(accessToken, lastTokenPayload.get(accessToken));
    },

    async verify(accessToken: string): Promise<boolean> {
      const url =
        descriptor.verifyUrl ??
        (descriptor.identity.from === 'endpoint' ? descriptor.identity.url : undefined);

      /*
       * No cheap authenticated call to make. Reporting "connected" is the
       * honest answer — the token was accepted when it was issued, and
       * inventing a request to a URL this provider may not serve would report
       * a failure that says nothing about the connection.
       */
      if (!url) return true;
      return tokenWorks(descriptor.key, url, accessToken);
    },
  };
}

/**
 * The token payload from the most recent exchange, keyed by the token it
 * contained.
 *
 * Only for providers that return the account inside it, and only between the
 * exchange and the identify call that immediately follows. Bounded, because a
 * map that only grows is a leak however small each entry is.
 */
const lastTokenPayload = new Map<string, Record<string, unknown>>();

setInterval(() => {
  if (lastTokenPayload.size > 50) lastTokenPayload.clear();
}, 60_000).unref?.();
