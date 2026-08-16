/**
 * Vercel integration (spec §38) — deploying generated applications.
 *
 * Vercel issues non-expiring access tokens through its OAuth flow and provides
 * no refresh endpoint, so `refresh` is deliberately absent: a connection that
 * stops working must be re-authorized, and the UI says so rather than retrying
 * a refresh that cannot exist.
 */
import { expiryFrom, getJson, parseScopes, postForToken, tokenWorks } from '../http';
import type {
  AuthorizeParams,
  ExchangeParams,
  ExternalAccount,
  IntegrationProvider,
  TokenSet,
} from '../types';

const AUTHORIZE_URL = 'https://vercel.com/oauth/authorize';
const TOKEN_URL = 'https://api.vercel.com/v2/oauth/access_token';
const API = 'https://api.vercel.com';

interface VercelUserResponse {
  readonly user?: { readonly id?: string; readonly username?: string; readonly avatar?: string };
}

export const vercelProvider: IntegrationProvider = {
  key: 'vercel',
  displayName: 'Vercel',
  requiredEnv: ['VERCEL_CLIENT_ID', 'VERCEL_CLIENT_SECRET'],
  usesPkce: false,

  scopeDescriptions: {
    deployment: 'Create and manage deployments of apps Reklu builds for you.',
    project: 'Create and configure Vercel projects.',
  },

  authorizeUrl({ credentials, state }: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchangeCode({ credentials, code }: ExchangeParams): Promise<TokenSet> {
    const body = await postForToken('vercel', TOKEN_URL, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: credentials.redirectUri,
    });

    const accessToken = String(body.access_token ?? '');
    if (!accessToken) throw new Error('Vercel returned no access token.');

    return {
      accessToken,
      tokenType: String(body.token_type ?? 'Bearer'),
      expiresAt: expiryFrom(body.expires_in),
      scopes: parseScopes(body.scope),
    };
  },

  async identify(accessToken: string): Promise<ExternalAccount> {
    const body = await getJson<VercelUserResponse>('vercel', `${API}/v2/user`, accessToken);
    const user = body.user;
    return {
      id: String(user?.id ?? 'unknown'),
      name: user?.username ?? 'Vercel account',
      avatarUrl: user?.avatar ? `https://vercel.com/api/www/avatar/${user.avatar}` : undefined,
    };
  },

  async verify(accessToken: string): Promise<boolean> {
    return tokenWorks('vercel', `${API}/v2/user`, accessToken);
  },
};
