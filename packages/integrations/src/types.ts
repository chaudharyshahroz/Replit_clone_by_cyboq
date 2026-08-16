/**
 * Third-party service integrations (spec §37–§39, §46).
 *
 * Every provider is described by the same shape, so the OAuth route handlers,
 * the connections UI and the token refresher are written once rather than
 * three times. Adding a provider means adding an adapter, not a code path.
 */

/** Providers Reklu can connect to. */
export const INTEGRATION_PROVIDERS = ['github', 'vercel', 'supabase'] as const;
export type IntegrationProviderKey = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: string): value is IntegrationProviderKey {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

/** The connected account, as the UI should display it. Never includes a token. */
export interface ExternalAccount {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | undefined;
}

/** A token set as returned by a provider's token endpoint. */
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly tokenType: string;
  /** Absolute expiry. Undefined means the provider issues non-expiring tokens. */
  readonly expiresAt?: Date | undefined;
  readonly scopes: readonly string[];
}

/**
 * What a provider needs from the environment. Reported by name when absent, so
 * the UI can say exactly which variable to set rather than "unavailable"
 * (spec §25).
 */
export interface ProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface AuthorizeParams {
  readonly credentials: ProviderCredentials;
  /** Opaque CSRF value; the provider echoes it back to the callback. */
  readonly state: string;
  /** PKCE challenge, for providers that support it. */
  readonly codeChallenge?: string | undefined;
}

export interface ExchangeParams {
  readonly credentials: ProviderCredentials;
  readonly code: string;
  readonly codeVerifier?: string | undefined;
}

/**
 * One integration provider.
 *
 * Adapters are pure with respect to storage: they speak to the provider's API
 * and return plain data. Persisting connections and encrypting tokens is done
 * once, in `connections.ts`, so no adapter can get that wrong.
 */
export interface IntegrationProvider {
  readonly key: IntegrationProviderKey;
  readonly displayName: string;
  /** Shown in the UI before the user authorizes, so consent is informed. */
  readonly scopeDescriptions: Readonly<Record<string, string>>;
  readonly requiredEnv: readonly [clientId: string, clientSecret: string];

  /** Whether this provider's token endpoint accepts PKCE. */
  readonly usesPkce: boolean;

  /** Build the provider's consent URL. */
  authorizeUrl(params: AuthorizeParams): string;

  /** Trade the authorization code for tokens. */
  exchangeCode(params: ExchangeParams): Promise<TokenSet>;

  /** Refresh an expiring token. Undefined when the provider has no refresh flow. */
  refresh?(params: {
    credentials: ProviderCredentials;
    refreshToken: string;
  }): Promise<TokenSet>;

  /** Identify the connected account, for display and for detecting duplicates. */
  identify(accessToken: string): Promise<ExternalAccount>;

  /**
   * Confirm a stored token still works. Used by the connections UI to show a
   * real status rather than assuming a saved row means a working connection.
   */
  verify(accessToken: string): Promise<boolean>;
}

/** Raised when a provider's API answers in a way Reklu cannot act on. */
export class IntegrationError extends Error {
  readonly provider: string;
  readonly status?: number | undefined;

  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = 'IntegrationError';
    this.provider = provider;
    this.status = status;
  }
}
