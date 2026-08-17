/**
 * Which sign-in providers this deployment has configured.
 *
 * Absent credentials produce an honest "not configured" state naming the exact
 * variables (spec §25) — never a button that fails after the user clicks it.
 */
import { loadServerEnv } from '@reklu/shared';
import {
  SIGN_IN_PROVIDERS,
  getSignInProvider,
  type SignInProviderCredentials,
  type SignInProviderKey,
} from './providers';

/** The callback Reklu registers with each provider. */
export function signInRedirectUri(provider: SignInProviderKey): string {
  const origin = loadServerEnv().APP_URL.replace(/\/+$/, '');
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

export function signInCredentials(
  provider: SignInProviderKey,
): SignInProviderCredentials | undefined {
  const env = loadServerEnv();
  const [clientId, clientSecret] =
    provider === 'google'
      ? [env.AUTH_GOOGLE_ID, env.AUTH_GOOGLE_SECRET]
      : [env.AUTH_GITHUB_ID, env.AUTH_GITHUB_SECRET];

  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret, redirectUri: signInRedirectUri(provider) };
}

export interface AvailableSignInProvider {
  readonly key: SignInProviderKey;
  readonly displayName: string;
  readonly configured: boolean;
  readonly requiredEnv: readonly string[];
}

export function availableSignInProviders(): AvailableSignInProvider[] {
  return SIGN_IN_PROVIDERS.map((key) => {
    const provider = getSignInProvider(key);
    return {
      key,
      displayName: provider.displayName,
      configured: signInCredentials(key) !== undefined,
      requiredEnv: provider.requiredEnv,
    };
  });
}
