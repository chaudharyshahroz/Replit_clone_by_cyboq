/**
 * The SearXNG adapter.
 *
 * SearXNG is self-hosted, which changes two things the paid providers get for
 * free: it is configured by address rather than by key, and a stock install
 * refuses JSON until someone edits settings.yml. Both produce confusing
 * failures if they are not handled deliberately, so both are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};

vi.mock('@reklu/shared', () => ({
  loadServerEnv: () => env,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { createWebAdapter } = await import('../sources/web');

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

/** The URL the adapter actually requested. */
function requestedUrl(): URL {
  const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
  return new URL(String(call[0]));
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearXNG configuration', () => {
  it('is configured by URL, with no API key', () => {
    env.SEARCH_PROVIDER = 'searxng';
    env.SEARXNG_URL = 'https://search.example.com';
    expect(createWebAdapter().isConfigured()).toBe(true);
  });

  it('is not configured when the URL is missing', () => {
    env.SEARCH_PROVIDER = 'searxng';
    expect(createWebAdapter().isConfigured()).toBe(false);
  });

  /** Silence would look identical to "no results for that query". */
  it('returns nothing rather than guessing when unconfigured', async () => {
    env.SEARCH_PROVIDER = 'searxng';
    respondWith({ results: [] });
    expect(await createWebAdapter().search('anything', 5)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('SearXNG search', () => {
  beforeEach(() => {
    env.SEARCH_PROVIDER = 'searxng';
    env.SEARXNG_URL = 'https://search.example.com';
  });

  it('asks for JSON from the instance search endpoint', async () => {
    respondWith({ results: [] });
    await createWebAdapter().search('espresso machines', 5);

    const url = requestedUrl();
    expect(url.origin).toBe('https://search.example.com');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('espresso machines');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('maps results into sources with their domain', async () => {
    respondWith({
      results: [
        { url: 'https://www.example.org/a', title: 'A', content: 'first' },
        { url: 'https://other.net/b', title: 'B' },
      ],
    });

    const sources = await createWebAdapter().search('q', 5);

    expect(sources).toEqual([
      {
        kind: 'web',
        url: 'https://www.example.org/a',
        title: 'A',
        snippet: 'first',
        domain: 'example.org',
        foundByQuery: 'q',
      },
      {
        kind: 'web',
        url: 'https://other.net/b',
        title: 'B',
        snippet: null,
        domain: 'other.net',
        foundByQuery: 'q',
      },
    ]);
  });

  /** SearXNG has no count parameter, so the cap has to be applied here. */
  it('honours the limit the caller asked for', async () => {
    respondWith({
      results: Array.from({ length: 25 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Result ${i}`,
      })),
    });

    expect(await createWebAdapter().search('q', 6)).toHaveLength(6);
  });

  /**
   * The first thing a fresh install does. Left generic, this reads as "search
   * is broken" when the fix is two lines in settings.yml.
   */
  it('explains a 403 as the JSON format being disabled', async () => {
    respondWith('Forbidden', 403);
    const sources = await createWebAdapter().search('q', 5);

    expect(sources).toEqual([]);

    const { logger } = (await import('@reklu/shared')) as unknown as {
      logger: { error: ReturnType<typeof vi.fn> };
    };
    /*
     * Read `message` off the Error rather than stringifying the fields: an
     * Error's own properties are not enumerable, so JSON.stringify renders it
     * as {} and this assertion would pass on any failure at all. The real
     * logger unpacks Errors properly, so the text does reach production logs.
     */
    const [, fields] = logger.error.mock.calls[0] as [string, { error: unknown }];
    expect((fields.error as Error).message).toMatch(/search\.formats/);
  });

  it('survives a trailing slash on the configured URL', async () => {
    env.SEARXNG_URL = 'https://search.example.com/';
    respondWith({ results: [] });
    await createWebAdapter().search('q', 5);

    expect(requestedUrl().pathname).toBe('/search');
  });

  /** A search failure is a partial result, not a failed research run. */
  it('returns no sources rather than throwing when the instance is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(createWebAdapter().search('q', 5)).resolves.toEqual([]);
  });
});
