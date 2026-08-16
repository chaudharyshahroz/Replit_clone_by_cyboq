/**
 * GitHub integration (spec §37).
 *
 * This is the repository connection — creating repos, pushing generated code,
 * reading files for context. It is a **different** OAuth application from
 * GitHub sign-in (`AUTH_GITHUB_ID`), because the two need different scopes and
 * a user may reasonably want one without the other.
 */
import { expiryFrom, getJson, parseScopes, postForToken, tokenWorks } from '../http';
import type {
  AuthorizeParams,
  ExchangeParams,
  ExternalAccount,
  IntegrationProvider,
  TokenSet,
} from '../types';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';

/**
 * `repo` is broad — GitHub has no narrower scope that still allows creating a
 * repository and pushing to it. The connections UI states this plainly rather
 * than burying it, because the user is granting access to every repository
 * they can reach.
 */
const SCOPES = ['repo', 'read:user', 'user:email'] as const;

interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly name?: string | null;
  readonly avatar_url?: string;
}

export const githubProvider: IntegrationProvider = {
  key: 'github',
  displayName: 'GitHub',
  requiredEnv: ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'],
  // GitHub's OAuth App flow does not implement PKCE.
  usesPkce: false,

  scopeDescriptions: {
    repo: 'Create repositories and push code, across every repository you can access.',
    'read:user': 'Read your GitHub profile, to show which account is connected.',
    'user:email': 'Read your email address, to attribute commits correctly.',
  },

  authorizeUrl({ credentials, state }: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', credentials.redirectUri);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },

  async exchangeCode({ credentials, code }: ExchangeParams): Promise<TokenSet> {
    const body = await postForToken('github', TOKEN_URL, {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: credentials.redirectUri,
    });

    const accessToken = String(body.access_token ?? '');
    if (!accessToken) throw new Error('GitHub returned no access token.');

    return {
      accessToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      tokenType: String(body.token_type ?? 'Bearer'),
      expiresAt: expiryFrom(body.expires_in),
      // GitHub may grant fewer scopes than requested; record what it actually gave.
      scopes: parseScopes(body.scope),
    };
  },

  async identify(accessToken: string): Promise<ExternalAccount> {
    const user = await getJson<GitHubUser>('github', `${API}/user`, accessToken, {
      Accept: 'application/vnd.github+json',
    });
    return {
      id: String(user.id),
      name: user.login,
      avatarUrl: user.avatar_url,
    };
  },

  async verify(accessToken: string): Promise<boolean> {
    return tokenWorks('github', `${API}/user`, accessToken, {
      Accept: 'application/vnd.github+json',
    });
  },
};
