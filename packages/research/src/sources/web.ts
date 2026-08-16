/**
 * Web search adapters (spec §23).
 *
 * Three providers behind one interface. When none is configured, research over
 * the web reports **"not configured"** naming the variable — it never falls
 * back to the model's memory and presents that as researched (spec §111).
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

export function createWebAdapter(): SourceAdapter {
  const env = loadServerEnv();
  const provider = env.SEARCH_PROVIDER;
  const key =
    provider === 'brave'
      ? env.BRAVE_SEARCH_API_KEY
      : provider === 'tavily'
        ? env.TAVILY_API_KEY
        : provider === 'serper'
          ? env.SERPER_API_KEY
          : undefined;

  return {
    kind: 'web',
    isConfigured: () => Boolean(provider && key),

    async search(query: string, limit: number): Promise<readonly DiscoveredSource[]> {
      if (!provider || !key) return [];

      try {
        const results =
          provider === 'brave'
            ? await searchBrave(query, limit, key)
            : provider === 'tavily'
              ? await searchTavily(query, limit, key)
              : await searchSerper(query, limit, key);

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
