/**
 * Supabase integration (spec §39) — provisioning a database for a generated app.
 *
 * Supabase's OAuth implementation supports PKCE and issues refresh tokens with
 * short-lived access tokens, so this is the one adapter with a real refresh
 * path. Its token endpoint authenticates the client with HTTP Basic rather
 * than form fields.
 */
import { expiryFrom, getJson, parseScopes, postForToken, tokenWorks } from '../http';
import type {
  AuthorizeParams,
  ExchangeParams,
  ExternalAccount,
  IntegrationProvider,
  ProviderCredentials,
  TokenSet,
} from '../types';

const AUTHORIZE_URL = 'https://api.supabase.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.supabase.com/v1/oauth/token';
const API = 'https://api.supabase.com';

interface SupabaseOrganization {
  readonly id: string;
  readonly name: string;
}

/** Supabase authenticates the client with Basic auth on the token endpoint. */
function basicAuth(credentials: ProviderCredentials): Record<string, string> {
  const encoded = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
    'utf8',
  ).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function toTokenSet(body: Record<string, unknown>): TokenSet {
  const accessToken = String(body.access_token ?? '');
  if (!accessToken) throw new Error('Supabase returned no access token.');
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    tokenType: String(body.token_type ?? 'Bearer'),
    expiresAt: expiryFrom(body.expires_in),
    scopes: parseScopes(body.scope),
  };
}

export const supabaseProvider: IntegrationProvider = {
  key: 'supabase',
  displayName: 'Supabase',
  requiredEnv: ['SUPABASE_CLIENT_ID', 'SUPABASE_CLIENT_SECRET'],
  usesPkce: true,

  scopeDescriptions: {
    'projects.write': 'Create Supabase projects for applications Reklu builds.',
    'organizations.read': 'Read your organizations, to choose where projects are created.',
  },

  authorizeUrl({ credentials, state, codeChallenge }: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  },

  async exchangeCode({ credentials, code, codeVerifier }: ExchangeParams): Promise<TokenSet> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: credentials.redirectUri,
    };
    if (codeVerifier) body.code_verifier = codeVerifier;

    return toTokenSet(await postForToken('supabase', TOKEN_URL, body, basicAuth(credentials)));
  },

  async refresh({ credentials, refreshToken }): Promise<TokenSet> {
    return toTokenSet(
      await postForToken(
        'supabase',
        TOKEN_URL,
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        basicAuth(credentials),
      ),
    );
  },

  async identify(accessToken: string): Promise<ExternalAccount> {
    const orgs = await getJson<SupabaseOrganization[]>(
      'supabase',
      `${API}/v1/organizations`,
      accessToken,
    );
    const first = orgs[0];
    return {
      id: first?.id ?? 'unknown',
      name: first?.name ?? 'Supabase account',
    };
  },

  async verify(accessToken: string): Promise<boolean> {
    return tokenWorks('supabase', `${API}/v1/organizations`, accessToken);
  },
};
