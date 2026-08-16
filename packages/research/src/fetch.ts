/**
 * Fetching sources.
 *
 * Every network fetch goes through the SSRF guard. Failures are **recorded, not
 * dropped** — a source that could not be retrieved is kept with its error so
 * the UI can say "14 of 18 sources retrieved" rather than rounding up to
 * success (spec §88).
 */
import { loadServerEnv, logger } from '@reklu/shared';
import { extractPublishedAt, extractReadableText, extractTitle, looksSubstantive } from './extract';
import { BlockedUrlError, checkRedirect, resolveSafeAddress } from './ssrf';
import type { DiscoveredSource, FetchedSource } from './types';

const MAX_RESPONSE_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

/** Per-domain concurrency, so research does not hammer one host. */
const PER_DOMAIN_LIMIT = 2;

export interface FetchOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Retrieve one source.
 *
 * Workspace sources carry their content inline and never touch the network.
 */
export async function fetchSource(
  source: DiscoveredSource,
  options: FetchOptions = {},
): Promise<FetchedSource> {
  const retrievedAt = new Date();

  if (source.localContent !== undefined) {
    return {
      ...source,
      content: source.localContent,
      fetchError: null,
      httpStatus: null,
      retrievedAt,
      publishedAt: null,
    };
  }

  if (!source.url) {
    return {
      ...source,
      content: null,
      fetchError: 'Source has no URL',
      httpStatus: null,
      retrievedAt,
      publishedAt: null,
    };
  }

  const env = loadServerEnv();
  const timeoutMs = options.timeoutMs ?? env.RESEARCH_FETCH_TIMEOUT_MS;
  const allowInsecureLocal = env.NODE_ENV !== 'production';

  const fail = (reason: string, status: number | null = null): FetchedSource => ({
    ...source,
    content: null,
    fetchError: reason,
    httpStatus: status,
    retrievedAt,
    publishedAt: null,
  });

  try {
    let target = await resolveSafeAddress(source.url, { allowInsecureLocal: false });
    let redirects = 0;
    let response: Response;

    // Follow redirects manually so each hop is re-validated. Automatic
    // following would let a permitted URL redirect straight to 169.254.169.254.
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        response = await fetch(target.url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': env.RESEARCH_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (++redirects > MAX_REDIRECTS) return fail('Too many redirects', response.status);
        target = await checkRedirect(location, target.url, { allowInsecureLocal });
        continue;
      }
      break;
    }

    if (!response.ok) return fail(`HTTP ${response.status}`, response.status);

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      return fail(`Unsupported content type: ${contentType.split(';')[0] || 'unknown'}`, response.status);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      return fail('Response too large', response.status);
    }

    const body = await readCapped(response, MAX_RESPONSE_BYTES);
    if (body === undefined) return fail('Response exceeded size limit', response.status);

    const text = extractReadableText(body);
    if (!looksSubstantive(text)) {
      // Recorded rather than silently kept: citing a cookie wall as evidence is
      // exactly the failure citations exist to prevent.
      return fail('Page had no substantive readable content', response.status);
    }

    return {
      ...source,
      title: extractTitle(body) ?? source.title,
      content: text,
      fetchError: null,
      httpStatus: response.status,
      retrievedAt,
      publishedAt: extractPublishedAt(body),
    };
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      logger.warn('Blocked a research fetch', { url: source.url, reason: error.reason });
      return fail(`Blocked: ${error.reason}`);
    }
    if ((error as Error)?.name === 'AbortError') return fail('Timed out');
    return fail(error instanceof Error ? error.message : 'Fetch failed');
  }
}

/** Read a body with a hard byte cap, so a huge response cannot exhaust memory. */
async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/**
 * Retrieve many sources concurrently, bounded per domain.
 *
 * Order is preserved so citation indexes stay stable.
 */
export async function fetchSources(
  sources: readonly DiscoveredSource[],
  options: FetchOptions = {},
): Promise<readonly FetchedSource[]> {
  const inFlightByDomain = new Map<string, number>();
  const results = new Array<FetchedSource>(sources.length);

  const queue = sources.map((source, index) => ({ source, index }));
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;

      const domain = next.source.domain ?? 'local';
      // Simple politeness gate: wait rather than pile onto one host.
      while ((inFlightByDomain.get(domain) ?? 0) >= PER_DOMAIN_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      inFlightByDomain.set(domain, (inFlightByDomain.get(domain) ?? 0) + 1);

      try {
        results[next.index] = await fetchSource(next.source, options);
      } finally {
        inFlightByDomain.set(domain, (inFlightByDomain.get(domain) ?? 1) - 1);
      }
    }
  });

  await Promise.all(workers);
  return results;
}
