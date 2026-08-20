/**
 * Web search adapters (spec §23).
 *
 * Four providers behind one interface. When none is configured, research over
 * the web reports **"not configured"** naming the variable — it never falls
 * back to the model's memory and presents that as researched (spec §111).
 *
 * SearXNG is the self-hosted one: it aggregates other engines and costs
 * nothing per query, so it takes an address rather than an API key.
 */
import { loadServerEnv, logger } from '@reklu/shared';
import type { DiscoveredSource, SourceAdapter } from '../types';

interface ProviderResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string | null;
}

const SEARCH_TIMEOUT_MS = 10_000;

/** Which env var backs each provider, for honest "not configured" messages. */
export const SEARCH_PROVIDER_ENV: Record<string, string> = {
  brave: 'BRAVE_SEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  serper: 'SERPER_API_KEY',
  searxng: 'SEARXNG_URL',
};

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function searchBrave(query: string, limit: number, key: string): Promise<ProviderResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(limit, 20)));

  const response = await withTimeout((signal) =>
    fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal,
    }),
  );
  if (!response.ok) throw new Error(`Brave search returned ${response.status}`);

  const body = (await response.json()) as {
    web?: { results?: { url: string; title: string; description?: string }[] };
  };
  return (body.web?.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.description ?? null,
  }));
}

async function searchTavily(query: string, limit: number, key: string): Promise<ProviderResult[]> {
  const response = await withTimeout((signal) =>
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: Math.min(limit, 20),
        search_depth: 'advanced',
      }),
      signal,
    }),
  );
  if (!response.ok) throw new Error(`Tavily search returned ${response.status}`);

  const body = (await response.json()) as {
    results?: { url: string; title: string; content?: string }[];
  };
  return (body.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.content ?? null,
  }));
}

async function searchSerper(query: string, limit: number, key: string): Promise<ProviderResult[]> {
  const response = await withTimeout((signal) =>
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
      signal,
    }),
  );
  if (!response.ok) throw new Error(`Serper search returned ${response.status}`);

  const body = (await response.json()) as {
    organic?: { link: string; title: string; snippet?: string }[];
  };
  return (body.organic ?? []).map((r) => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet ?? null,
  }));
}

/**
 * A self-hosted SearXNG instance.
 *
 * Two things differ from the paid providers and both are worth stating,
 * because each produces a confusing failure rather than an obvious one:
 *
 *   JSON is off by default. A stock install answers `format=json` with a 403,
 *   and the fix is in the instance's settings.yml, not here — so the error
 *   says so rather than reporting a generic upstream failure.
 *
 *   There is no result-count parameter. SearXNG returns a page of results and
 *   pages with `pageno`, so the limit is applied after the fact.
 */
async function searchSearxng(
  query: string,
  limit: number,
  baseUrl: string,
): Promise<ProviderResult[]> {
  const url = new URL('/search', baseUrl.replace(/\/+$/, ''));
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', 'general');
  url.searchParams.set('safesearch', '0');

  const response = await withTimeout((signal) =>
    fetch(url, {
      headers: {
        Accept: 'application/json',
        // Some instances refuse requests without a User-Agent.
        'User-Agent': 'Reklu/1.0 (+https://reklu.app)',
      },
      signal,
    }),
  );

  if (response.status === 403) {
    throw new Error(
      'SearXNG refused format=json (403). Add `json` to `search.formats` in the instance settings.yml and restart it.',
    );
  }
  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);

  const body = (await response.json()) as {
    results?: { url: string; title: string; content?: string }[];
  };

  return (body.results ?? []).slice(0, limit).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.content ?? null,
  }));
}

export function createWebAdapter(): SourceAdapter {
  const env = loadServerEnv();
  const provider = env.SEARCH_PROVIDER;

  /*
   * For SearXNG this is the instance URL, not a credential. Same slot, because
   * what matters to `isConfigured` is whether the one thing this provider
   * needs is present.
   */
  const credential =
    provider === 'brave'
      ? env.BRAVE_SEARCH_API_KEY
      : provider === 'tavily'
        ? env.TAVILY_API_KEY
        : provider === 'serper'
          ? env.SERPER_API_KEY
          : provider === 'searxng'
            ? env.SEARXNG_URL
            : undefined;

  return {
    kind: 'web',
    isConfigured: () => Boolean(provider && credential),

    async search(query: string, limit: number): Promise<readonly DiscoveredSource[]> {
      if (!provider || !credential) return [];

      try {
        const results =
          provider === 'brave'
            ? await searchBrave(query, limit, credential)
            : provider === 'tavily'
              ? await searchTavily(query, limit, credential)
              : provider === 'serper'
                ? await searchSerper(query, limit, credential)
                : await searchSearxng(query, limit, credential);

        return results.map((result) => ({
          kind: 'web' as const,
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          domain: domainOf(result.url),
          foundByQuery: query,
        }));
      } catch (error) {
        // A failed search is a partial result, not a failed research run —
        // other queries and adapters may still return sources.
        logger.error('Web search failed', { error, provider, query });
        return [];
      }
    },
  };
}
