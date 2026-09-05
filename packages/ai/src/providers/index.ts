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

    case 'kimi':
      if (env.MOONSHOT_API_KEY) {
        /*
         * Kimi's official platform is operated by Moonshot AI and exposes an
         * OpenAI-compatible Chat Completions API at api.moonshot.ai. Keep the
         * key and host separate from OpenAI so credentials can never cross.
         */
        const kimi = createOpenAI({
          apiKey: env.MOONSHOT_API_KEY,
          baseURL: env.MOONSHOT_BASE_URL,
        });

        provider = createVendorAdapter({
          key: 'kimi',
          displayName: 'Kimi',
          capabilities: FULL,
          model: (id: string) => kimi.chat(id),
          /* Current Kimi models require their documented fixed temperature. */
          omitTemperature: true,
        });
      }
      break;

    case 'openrouter':
      if (env.OPENROUTER_API_KEY) {
        const openrouter = createOpenAI({
          apiKey: env.OPENROUTER_API_KEY,
          baseURL: env.OPENROUTER_BASE_URL,
          /*
           * OpenRouter attributes traffic by these, and uses them to decide
           * whether a request may use the free tier at all. They identify the
           * application, never the person using it.
           */
          headers: { 'HTTP-Referer': env.APP_URL, 'X-Title': 'Reklu' },
        });

        provider = createVendorAdapter({
          key: 'openrouter',
          displayName: 'OpenRouter',
          /*
           * Declared per provider and true of the route, not of every model
           * behind it. OpenRouter fronts hundreds, and what any one supports is
           * a property of that model's row in the registry.
           */
          capabilities: FULL,
          /*
           * Chat Completions explicitly, not the SDK's default.
           *
           * `openai(id)` resolves to the Responses API, which is OpenAI's own
           * newer surface. An OpenAI-*compatible* provider implements Chat
           * Completions — that is what compatible means — and may or may not
           * have Responses. Sending the wrong one produces a 404 from a host
           * that is working perfectly, about a model that exists.
           */
          model: (id: string) => openrouter.chat(id),
        });
      }
      break;

    case 'bai':
      if (env.BAI_API_KEY) {
        const bai = createOpenAI({ apiKey: env.BAI_API_KEY, baseURL: env.BAI_BASE_URL });

        provider = createVendorAdapter({
          key: 'bai',
          displayName: 'B.AI',
          /*
           * Declared for the route rather than for any one model behind it.
           * What a given model supports is a property of its registry row —
           * one of these reads images and the rest do not.
           */
          capabilities: FULL,
          /* Chat Completions, for the reason given on OpenRouter above. */
          model: (id: string) => bai.chat(id),
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
  if (env.MOONSHOT_API_KEY) keys.push('kimi');
  if (env.OPENROUTER_API_KEY) keys.push('openrouter');
  if (env.BAI_API_KEY) keys.push('bai');
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
