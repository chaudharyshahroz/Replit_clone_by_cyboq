/**
 * Provider registry and configuration reporting.
 *
 * A provider whose credentials are absent is *not* hidden and *not* faked: the
 * UI shows it with the exact environment variables an operator must set
 * (spec §25). A dead "Connect" button would be worse than an honest one.
 */
import { loadServerEnv } from '@reklu/shared';
import { githubProvider } from './providers/github';
import { googleProvider } from './providers/google';
import { supabaseProvider } from './providers/supabase';
import { vercelProvider } from './providers/vercel';
import {
  INTEGRATION_PROVIDERS,
  type IntegrationProvider,
  type IntegrationProviderKey,
  type ProviderCredentials,
} from './types';

const PROVIDERS: Readonly<Record<IntegrationProviderKey, IntegrationProvider>> = {
  github: githubProvider,
  google: googleProvider,
  vercel: vercelProvider,
  supabase: supabaseProvider,
};

export function getProvider(key: IntegrationProviderKey): IntegrationProvider {
  return PROVIDERS[key];
}

export function allProviders(): readonly IntegrationProvider[] {
  return INTEGRATION_PROVIDERS.map((key) => PROVIDERS[key]);
}

/** The redirect URI a provider must have registered, derived from APP_URL. */
export function redirectUriFor(key: IntegrationProviderKey): string {
  const env = loadServerEnv();
  const configured =
    key === 'github'
      ? env.GITHUB_OAUTH_REDIRECT_URI
      : key === 'google'
        ? env.GOOGLE_OAUTH_REDIRECT_URI
        : key === 'vercel'
          ? env.VERCEL_OAUTH_REDIRECT_URI
          : env.SUPABASE_OAUTH_REDIRECT_URI;

  // Deriving from APP_URL by default means the callback is right in every
  // environment without a fourth variable to keep in sync.
  return configured ?? `${env.APP_URL}/api/integrations/${key}/callback`;
}

export interface ProviderConfiguration {
  readonly provider: IntegrationProvider;
  readonly configured: boolean;
  /** Names of the variables that are missing. Empty when configured. */
  readonly missingEnv: readonly string[];
  readonly redirectUri: string;
}

export function describeProvider(key: IntegrationProviderKey): ProviderConfiguration {
  const env = loadServerEnv() as unknown as Record<string, string | undefined>;
  const provider = PROVIDERS[key];
  const missingEnv = provider.requiredEnv.filter((name) => !env[name]);

  return {
    provider,
    configured: missingEnv.length === 0,
    missingEnv,
    redirectUri: redirectUriFor(key),
  };
}

export function describeAllProviders(): readonly ProviderConfiguration[] {
  return INTEGRATION_PROVIDERS.map(describeProvider);
}

/**
 * Credentials for a provider, or undefined when unconfigured.
 *
 * Returning undefined rather than throwing lets callers distinguish "the
 * operator has not set this up" from "the provider rejected us" — two states
 * that need very different messages.
 */
export function credentialsFor(key: IntegrationProviderKey): ProviderCredentials | undefined {
  const env = loadServerEnv() as unknown as Record<string, string | undefined>;
  const provider = PROVIDERS[key];
  const [idVar, secretVar] = provider.requiredEnv;

  const clientId = env[idVar];
  const clientSecret = env[secretVar];
  if (!clientId || !clientSecret) return undefined;

  return { clientId, clientSecret, redirectUri: redirectUriFor(key) };
}
