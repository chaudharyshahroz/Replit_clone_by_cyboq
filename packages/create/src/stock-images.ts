/**
 * Photographs from Pixabay (spec §44).
 *
 * A generated image costs money and about half a minute, and a page wanting six
 * of them costs six of each. For most of what a marketing site needs — a barber
 * at work, a coffee bar, a plate of food — a real photograph of that thing
 * already exists, is free, and arrives in under a second.
 *
 * So this is tried first and image generation becomes the fallback. The two are
 * good at different things: a search finds a real photograph of an ordinary
 * subject, and fails on anything specific to one business; a generation always
 * returns something, at a price. Trying the cheap one first and falling through
 * costs a single HTTP request when it misses.
 *
 * Pixabay's licence permits redistribution but forbids hotlinking, so the bytes
 * are downloaded and stored like any other object rather than linked from their
 * CDN. That is also what makes an exported site self-contained.
 */
import { loadServerEnv, logger, newId } from '@reklu/shared';
import { buildKey, storage } from '@reklu/storage';

export interface StockImageInput {
  readonly workspaceId: string;
  /** What the picture must show. The alt text, in practice. */
  readonly query: string;
  readonly shape: 'landscape' | 'square' | 'portrait';
}

export interface StockImage {
  readonly storageKey: string;
  readonly contentType: string;
  readonly bytes: number;
  /** Who took it. Not required by the licence; recorded because it is true. */
  readonly credit: string;
}

/** Whether a stock search can run at all. */
export function stockImagesAvailable(): boolean {
  return Boolean(loadServerEnv().PIXABAY_API_KEY);
}

/**
 * A search query from a sentence written to be read aloud.
 *
 * Alt text is a description — "a barber trimming a beard with clippers in a
 * warm wood-panelled shop" — and a search engine does better with the nouns
 * than with the sentence. The articles and prepositions are dropped and the
 * result is capped, because a long query returns nothing at all rather than
 * something approximate.
 */
export function searchTerms(description: string): string {
  const stop = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'and', 'or', 'for', 'to',
    'from', 'by', 'into', 'over', 'under', 'is', 'are', 'as', 'that', 'this',
    'photograph', 'photo', 'image', 'picture', 'shot',
  ]);

  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word))
    .slice(0, 6)
    .join(' ');
}

const ORIENTATION = {
  landscape: 'horizontal',
  portrait: 'vertical',
  /* Pixabay has no square orientation; horizontal crops to square acceptably. */
  square: 'horizontal',
} as const;

const TIMEOUT_MS = 15_000;

/**
 * Find a photograph, or return nothing.
 *
 * Returning `undefined` rather than throwing is the point: a miss is ordinary
 * and the caller has somewhere else to go. Only a configuration problem is
 * worth raising, and there is none — an absent key simply means this is off.
 */
export async function findStockImage(input: StockImageInput): Promise<StockImage | undefined> {
  const env = loadServerEnv();
  if (!env.PIXABAY_API_KEY) return undefined;

  const query = searchTerms(input.query);
  if (!query) return undefined;

  try {
    const url = new URL('https://pixabay.com/api/');
    url.searchParams.set('key', env.PIXABAY_API_KEY);
    url.searchParams.set('q', query);
    url.searchParams.set('image_type', 'photo');
    url.searchParams.set('orientation', ORIENTATION[input.shape]);
    /* The site is public and Reklu does not review what it puts on one. */
    url.searchParams.set('safesearch', 'true');
    url.searchParams.set('order', 'popular');
    url.searchParams.set('per_page', '3');

    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      logger.debug('Pixabay refused a search', { status: response.status });
      return undefined;
    }

    const payload = (await response.json()) as {
      hits?: { largeImageURL?: string; user?: string; imageWidth?: number }[];
    };

    const hit = payload.hits?.find((candidate) => candidate.largeImageURL);
    if (!hit?.largeImageURL) return undefined;

    const image = await fetch(hit.largeImageURL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!image.ok) return undefined;

    const body = Buffer.from(await image.arrayBuffer());
    /*
     * Guarded because the bytes come from somewhere else. A response claiming
     * to be a photograph and running to fifty megabytes is not one worth
     * putting on a page, whatever it is.
     */
    if (body.byteLength < 1_000 || body.byteLength > 12_000_000) return undefined;

    const contentType = image.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) return undefined;

    const key = buildKey({
      workspaceId: input.workspaceId,
      scope: 'media',
      fileId: newId('file'),
      suffix: 'stock.jpg',
    });

    await storage().put({
      key,
      body,
      contentType,
      filename: 'stock.jpg',
      metadata: { source: 'pixabay' },
    });

    return {
      storageKey: key,
      contentType,
      bytes: body.byteLength,
      credit: hit.user ? `${hit.user} / Pixabay` : 'Pixabay',
    };
  } catch (error) {
    /*
     * Never fatal. This is the cheap path; the expensive one still works, and a
     * search that timed out is not a reason to fail a build.
     */
    logger.debug('Could not find a stock image', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
