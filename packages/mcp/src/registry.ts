/**
 * Finding servers to connect, from the registry that maintains them.
 *
 * Reklu could always connect to an MCP server; what it could not do was tell
 * anybody which ones exist. Somebody had to already know an endpoint, which is
 * a thing almost nobody knows.
 *
 * The obvious answer is a list of well-known servers in the code. It is also
 * the wrong one, and this repository has already paid for that lesson: a list
 * of free model identifiers was hardcoded and every one of them was withdrawn
 * within days, failing in a way that looked like Reklu was broken. Endpoints
 * rot the same way. The registry is maintained by the people who maintain the
 * protocol, so it is asked at the moment somebody looks.
 */
import { logger } from '@reklu/shared';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const TIMEOUT_MS = 10_000;

export interface RegistryServer {
  /** The registry's identifier, which is a namespaced name rather than a title. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The endpoint Reklu would connect to. */
  readonly url: string;
  /** True when the server requires a token, so the form can ask for one. */
  readonly needsCredential: boolean;
  readonly repository?: string | undefined;
}

interface RegistryEntry {
  readonly server?: {
    readonly name?: string;
    readonly title?: string;
    readonly description?: string;
    readonly repository?: { readonly url?: string };
    readonly remotes?: {
      readonly type?: string;
      readonly url?: string;
      readonly headers?: { readonly isRequired?: boolean; readonly isSecret?: boolean }[];
    }[];
  };
  readonly _meta?: {
    readonly 'io.modelcontextprotocol.registry/official'?: {
      readonly status?: string;
      readonly isLatest?: boolean;
    };
  };
}

/**
 * Turn a registry entry into something Reklu can offer, or nothing.
 *
 * Three filters, each of which would otherwise put an unusable row in front of
 * somebody. A server with no remote is a local process — Reklu connects over
 * HTTP and does not run other people's code on its own machine. A superseded
 * version is a duplicate of a newer row. A withdrawn one no longer answers.
 */
export function readEntry(entry: RegistryEntry): RegistryServer | undefined {
  const meta = entry._meta?.['io.modelcontextprotocol.registry/official'];
  if (meta?.isLatest === false) return undefined;
  if (meta?.status && meta.status !== 'active') return undefined;

  const server = entry.server;
  if (!server?.name) return undefined;

  const remote = server.remotes?.find(
    (candidate) =>
      typeof candidate.url === 'string' &&
      /^https:\/\//.test(candidate.url) &&
      (candidate.type === 'streamable-http' || candidate.type === 'sse'),
  );
  if (!remote?.url) return undefined;

  return {
    name: server.name,
    /* A namespaced name is not a label; fall back to it only when there is none. */
    title: server.title?.trim() || server.name,
    description: server.description?.trim() ?? '',
    url: remote.url,
    needsCredential: (remote.headers ?? []).some((header) => header.isRequired),
    ...(server.repository?.url ? { repository: server.repository.url } : {}),
  };
}

/**
 * Search the registry.
 *
 * Returns nothing rather than throwing when the registry cannot be reached:
 * this is a discovery aid beside a form that already works, and a directory
 * being down is not a reason to stop somebody pasting an endpoint they know.
 */
export async function searchRegistry(
  query: string,
  limit = 30,
): Promise<readonly RegistryServer[]> {
  const url = new URL(REGISTRY);
  if (query.trim()) url.searchParams.set('search', query.trim());
  /* Over-fetched, because filtering happens here and thins the list. */
  url.searchParams.set('limit', String(Math.min(limit * 3, 100)));

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.debug('The MCP registry refused a search', { status: response.status });
      return [];
    }

    const payload = (await response.json()) as { servers?: RegistryEntry[] };

    /* One row per server, keeping the first — the registry orders newest first. */
    const seen = new Set<string>();
    const results: RegistryServer[] = [];

    for (const entry of payload.servers ?? []) {
      const server = readEntry(entry);
      if (!server || seen.has(server.name)) continue;
      seen.add(server.name);
      results.push(server);
      if (results.length >= limit) break;
    }

    return results;
  } catch (error) {
    logger.debug('Could not reach the MCP registry', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
