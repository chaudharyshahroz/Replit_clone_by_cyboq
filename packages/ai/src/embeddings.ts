/**
 * Embeddings.
 *
 * Wraps the configured embedding provider so callers never branch on which
 * vendor is in use. Returns `undefined` when embeddings are not configured
 * rather than throwing — semantic retrieval is an enhancement, and the callers
 * degrade to lexical search instead of failing the user's request.
 */
import { loadServerEnv, logger } from '@reklu/shared';
import { getProvider } from './providers';

export interface EmbedResultBatch {
  readonly embeddings: readonly (readonly number[])[];
  readonly inputTokens: number;
  readonly model: string;
}

/** True when this instance can produce embeddings at all. */
export function embeddingsAvailable(): boolean {
  const env = loadServerEnv();
  const key =
    env.EMBEDDING_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GOOGLE_GENERATIVE_AI_API_KEY;
  return Boolean(key) && env.DATABASE_VECTOR_ENABLED;
}

/**
 * Embed a batch of texts.
 *
 * Returns undefined when unavailable. Callers must handle that — a silent
 * zero-vector would poison similarity search in a way that is very hard to
 * notice, because every query would still "work" and just return nonsense.
 */
export async function embedTexts(
  values: readonly string[],
  signal?: AbortSignal,
): Promise<EmbedResultBatch | undefined> {
  if (values.length === 0) return { embeddings: [], inputTokens: 0, model: 'none' };
  if (!embeddingsAvailable()) return undefined;

  const env = loadServerEnv();
  const provider = getProvider(env.EMBEDDING_PROVIDER);
  if (!provider?.embed) return undefined;

  try {
    const result = await provider.embed({
      modelIdentifier: env.EMBEDDING_MODEL,
      values,
      ...(signal ? { signal } : {}),
    });

    // A width mismatch would be silently truncated by pgvector's fixed
    // dimension, so refuse rather than store a corrupted vector.
    const width = result.embeddings[0]?.length;
    if (width !== undefined && width !== env.EMBEDDING_DIMENSIONS) {
      logger.error('Embedding dimension mismatch — refusing to store', {
        expected: env.EMBEDDING_DIMENSIONS,
        received: width,
        model: env.EMBEDDING_MODEL,
      });
      return undefined;
    }

    return {
      embeddings: result.embeddings,
      inputTokens: result.inputTokens,
      model: env.EMBEDDING_MODEL,
    };
  } catch (error) {
    logger.error('Embedding request failed', { error, model: env.EMBEDDING_MODEL });
    return undefined;
  }
}

/** Convenience for a single value. */
export async function embedOne(
  value: string,
  signal?: AbortSignal,
): Promise<readonly number[] | undefined> {
  const result = await embedTexts([value], signal);
  return result?.embeddings[0];
}
