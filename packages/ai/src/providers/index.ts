/**
 * Provider construction.
 *
 * The only place vendor SDKs are imported. Providers are built lazily and
 * cached, so an unconfigured vendor costs nothing and a missing key surfaces as
 * "not configured" rather than a crash at import time.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { loadServerEnv } from '@reklu/shared';
import type { AIProvider, ProviderCapabilities } from '../types';
import { createVendorAdapter } from './vendor';
import { createDevEchoProvider, DEV_ECHO_PROVIDER_KEY } from './dev-echo';

export { DEV_ECHO_MODEL_KEY, DEV_ECHO_PROVIDER_KEY, DEV_ECHO_SLOW_MODEL_KEY } from './dev-echo';

const FULL: ProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  structuredOutput: true,
  embeddings: false,
  reasoning: true,
};

const cache = new Map<string, AIProvider>();

/**
 * Build a provider by key, or undefined when this instance has no credential
 * for it. Callers turn `undefined` into a NOT_CONFIGURED error naming the
 * variable — never into a silent fallback to a different vendor.
 */
export function getProvider(providerKey: string): AIProvider | undefined {
  const cached = cache.get(providerKey);
  if (cached) return cached;

  const env = loadServerEnv();
  let provider: AIProvider | undefined;

  switch (providerKey) {
    case 'anthropic':
      if (env.ANTHROPIC_API_KEY) {
        provider = createVendorAdapter({
          key: 'anthropic',
          displayName: 'Anthropic',
          capabilities: FULL,
          model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }),
        });
      }
      break;

    case 'openai':
      if (env.OPENAI_API_KEY) {
        const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
        provider = createVendorAdapter({
          key: 'openai',
          displayName: 'OpenAI',
          capabilities: { ...FULL, embeddings: true },
          model: openai,
          embeddingModel: (id) => openai.textEmbeddingModel(id),
        });
      }
      break;

    case 'google':
      if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
        const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
        provider = createVendorAdapter({
          key: 'google',
          displayName: 'Google',
          capabilities: { ...FULL, embeddings: true },
          model: google,
          embeddingModel: (id) => google.textEmbeddingModel(id),
        });
      }
      break;

    case 'xai':
      if (env.XAI_API_KEY) {
        provider = createVendorAdapter({
          key: 'xai',
          displayName: 'xAI',
          capabilities: FULL,
          model: createXai({ apiKey: env.XAI_API_KEY }),
        });
      }
      break;

    case 'deepseek':
      if (env.DEEPSEEK_API_KEY) {
        provider = createVendorAdapter({
          key: 'deepseek',
          displayName: 'DeepSeek',
          capabilities: { ...FULL, vision: false },
          model: createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY }),
        });
      }
      break;

    case DEV_ECHO_PROVIDER_KEY:
      // Only available when no real provider exists, and never in production.
      if (env.NODE_ENV !== 'production') {
        provider = createDevEchoProvider();
      }
      break;

    default:
      provider = undefined;
  }

  if (provider) cache.set(providerKey, provider);
  return provider;
}

/** Which provider keys this instance actually holds credentials for. */
export function configuredProviderKeys(): readonly string[] {
  const env = loadServerEnv();
  const keys: string[] = [];
  if (env.ANTHROPIC_API_KEY) keys.push('anthropic');
  if (env.OPENAI_API_KEY) keys.push('openai');
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) keys.push('google');
  if (env.XAI_API_KEY) keys.push('xai');
  if (env.DEEPSEEK_API_KEY) keys.push('deepseek');
  return keys;
}

/**
 * True when no real vendor is configured and the development mock should stand
 * in. Always false in production, where missing providers fail startup instead.
 */
export function shouldUseDevelopmentMock(): boolean {
  const env = loadServerEnv();
  return env.NODE_ENV !== 'production' && configuredProviderKeys().length === 0;
}

/** Test helper. */
export function resetProviderCache(): void {
  cache.clear();
}
