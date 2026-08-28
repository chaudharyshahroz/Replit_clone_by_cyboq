/**
 * Provider registry and configuration reporting.
 *
 * A provider whose credentials are absent is *not* hidden and *not* faked: the
 * UI shows it with the exact environment variables an operator must set
 * (spec §25). A dead "Connect" button would be worse than an honest one.
 */
import { loadServerEnv } from '@reklu/shared';
import { CATALOGUE } from './catalogue';
import { createOAuthProvider } from './oauth-catalogue';
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

/**
 * Every provider, hand-written and catalogued together.
 *
 * The four with their own files are there because each does something a
 * generic OAuth client cannot — push a repository, create a deployment, read a
 * Drive. Everything else is a descriptor, so adding a connector is adding an
 * entry rather than a code path.
 *
 * A hand-written provider wins a collision. If one is ever promoted out of the
 * catalogue, the file is the newer answer and the entry is the leftover.
 */
const PROVIDERS: ReadonlyMap<string, IntegrationProvider> = new Map([
  ...CATALOGUE.map(
    (descriptor) => [descriptor.key, createOAuthProvider(descriptor)] as const,
  ),
  ['github', githubProvider] as const,
  ['google', googleProvider] as const,
  ['vercel', vercelProvider] as const,
  ['supabase', supabaseProvider] as const,
]);

/**
 * Whether a string names a provider Reklu knows.
 *
 * Load-bearing: the OAuth callback route uses it to decide whether a redirect
 * is for something real before it does anything with the code in it.
 */
export function isIntegrationProvider(value: string): value is IntegrationProviderKey {
  return PROVIDERS.has(value);
}

export function getProvider(key: IntegrationProviderKey): IntegrationProvider {
  const provider = PROVIDERS.get(key);
  if (!provider) throw new Error(`No integration provider named ${key}`);
  return provider;
}

export function allProviders(): readonly IntegrationProvider[] {
  /* The hand-written ones first: they are the ones that do more than connect. */
  const written = INTEGRATION_PROVIDERS.map((key) => PROVIDERS.get(key)!);
  const catalogued = CATALOGUE.map((descriptor) => PROVIDERS.get(descriptor.key)!);
  return [...written, ...catalogued];
}

/** The redirect URI a provider must have registered, derived from APP_URL. */
export function redirectUriFor(key: IntegrationProviderKey): string {
  const env = loadServerEnv();
  /*
   * An override, where one is declared. A catalogued provider has none — its
   * callback is derived, which is the point of not needing a variable per
   * connector.
   */
  const overrides: Record<string, string | undefined> = {
    github: env.GITHUB_OAUTH_REDIRECT_URI,
    google: env.GOOGLE_OAUTH_REDIRECT_URI,
    vercel: env.VERCEL_OAUTH_REDIRECT_URI,
    supabase: env.SUPABASE_OAUTH_REDIRECT_URI,
  };
  const configured = overrides[key];

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
  const provider = getProvider(key);

  /*
   * Read from the process environment rather than the validated one, because a
   * catalogued provider's variables are named after its key and a fixed schema
   * cannot enumerate data. The values are only tested for presence here; they
   * are read for use through the same path every other credential is.
   */
  const env = { ...process.env, ...(loadServerEnv() as unknown as Record<string, string | undefined>) };
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
  /* Both, for the same reason describeProvider reads both. */
  const env = {
    ...process.env,
    ...(loadServerEnv() as unknown as Record<string, string | undefined>),
  };
  const provider = getProvider(key);
  const [idVar, secretVar] = provider.requiredEnv;

  const clientId = env[idVar];
  const clientSecret = env[secretVar];
  if (!clientId || !clientSecret) return undefined;

  return { clientId, clientSecret, redirectUri: redirectUriFor(key) };
}
