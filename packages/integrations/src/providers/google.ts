/**
 * Google integration — the connector, not the sign-in (spec §37).
 *
 * A separate OAuth application from Google sign-in, for the same reason GitHub
 * is: signing in needs to know who somebody is, and this needs to read their
 * files. Someone may reasonably want one without the other, and bundling them
 * would mean asking for Drive access from anybody who just wanted a login
 * button.
 *
 * Read-only, deliberately. Every scope here is a `.readonly` variant, so a
 * mistake in Reklu — or a model asked to "tidy up my Drive" — cannot delete
 * somebody's documents. Writing to Drive is a separate grant and a separate
 * decision, and it is not this one.
 */
import { expiryFrom, getJson, parseScopes, postForToken, tokenWorks } from '../http';
import type {
  AuthorizeParams,
  ExchangeParams,
  ExternalAccount,
  IntegrationProvider,
  TokenSet,
} from '../types';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * What Reklu asks for, and nothing beyond it.
 *
 * `drive.readonly` covers Docs, Sheets and Slides too — they are Drive files —
 * so one scope answers what looks like four connectors on other products.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

interface GoogleUser {
  readonly id: string;
  readonly email?: string;
  readonly name?: string;
  readonly picture?: string;
}

export const googleProvider: IntegrationProvider = {
  key: 'google',
  displayName: 'Google',
  requiredEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  usesPkce: true,

  scopeDescriptions: {
    'https://www.googleapis.com/auth/drive.readonly':
      'Read your Drive files, including Docs, Sheets and Slides. Reklu cannot change or delete anything.',
    'https://www.googleapis.com/auth/calendar.readonly':
      'Read your calendar events. Reklu cannot create, move or cancel anything.',
    'https://www.googleapis.com/auth/userinfo.email': 'See which Google account this is.',
    'https://www.googleapis.com/auth/userinfo.profile': 'See your name and picture, to label the connection.',
  },

  authorizeUrl({ credentials, state, codeChallenge }: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);

    /*
     * Both required, and both easy to omit. Google issues a refresh token only
     * for an offline request, and only the first time somebody consents — so
     * without `prompt=consent` a reconnection returns an access token that
     * expires in an hour and nothing to renew it with, and the connection dies
     * quietly at the end of the day.
     */
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  },

  async exchangeCode({ credentials, code, codeVerifier }: ExchangeParams): Promise<TokenSet> {
    const payload = await postForToken('google', TOKEN_URL, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: credentials.redirectUri,
      grant_type: 'authorization_code',
      code,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });

    return {
      accessToken: String(payload['access_token'] ?? ''),
      refreshToken: payload['refresh_token'] ? String(payload['refresh_token']) : undefined,
      tokenType: String(payload['token_type'] ?? 'Bearer'),
      expiresAt: expiryFrom(payload['expires_in']),
      scopes: parseScopes(payload['scope']),
    };
  },

  async refresh({ credentials, refreshToken }): Promise<TokenSet> {
    const payload = await postForToken('google', TOKEN_URL, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    return {
      accessToken: String(payload['access_token'] ?? ''),
      /*
       * Google does not return the refresh token again. Carrying the old one
       * forward is what keeps the connection alive past the second hour —
       * dropping it here would look like it worked and fail tomorrow.
       */
      refreshToken,
      tokenType: String(payload['token_type'] ?? 'Bearer'),
      expiresAt: expiryFrom(payload['expires_in']),
      scopes: parseScopes(payload['scope']),
    };
  },

  async identify(accessToken: string): Promise<ExternalAccount> {
    const user = await getJson<GoogleUser>('google', USERINFO, accessToken);

    return {
      id: user.id,
      /* The address, because a Google account is recognised by which one it is. */
      name: user.email ?? user.name ?? user.id,
      ...(user.picture ? { avatarUrl: user.picture } : {}),
    };
  },

  async verify(accessToken: string): Promise<boolean> {
    return tokenWorks('google', USERINFO, accessToken);
  },
};
