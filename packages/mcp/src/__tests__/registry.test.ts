/**
 * Reading the MCP registry.
 *
 * Reklu could always connect to an MCP server and could never say which ones
 * exist, so somebody had to already know an endpoint — a thing almost nobody
 * knows. The obvious fix is a list of well-known servers in the code, and this
 * repository has already paid for that: a hardcoded list of free model
 * identifiers was withdrawn upstream within days and failed in a way that
 * looked like Reklu was broken. Endpoints rot the same way.
 *
 * What these tests protect is the filtering, because every row that survives it
 * is offered to somebody as a thing they can connect to.
 */
import { describe, expect, it } from 'vitest';
import { readEntry } from '../registry';

const entry = (overrides: Record<string, unknown> = {}) => ({
  server: {
    name: 'ai.smithery/smithery-notion',
    title: 'Notion',
    description: 'A Notion workspace.',
    remotes: [{ type: 'streamable-http', url: 'https://server.smithery.ai/@smithery/notion/mcp' }],
    ...overrides,
  },
  _meta: {
    'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
  },
});

describe('a registry entry Reklu can offer', () => {
  it('carries the endpoint and a readable name', () => {
    const server = readEntry(entry());

    expect(server?.title).toBe('Notion');
    expect(server?.url).toBe('https://server.smithery.ai/@smithery/notion/mcp');
  });

  it('says when a credential is required, so the form can ask', () => {
    const withAuth = readEntry(
      entry({
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://server.smithery.ai/mcp',
            headers: [{ isRequired: true, isSecret: true }],
          },
        ],
      }),
    );

    expect(withAuth?.needsCredential).toBe(true);
    expect(readEntry(entry())?.needsCredential).toBe(false);
  });

  it('falls back to the name when there is no title', () => {
    /* A namespaced identifier is not a label, but it beats an empty row. */
    expect(readEntry(entry({ title: undefined }))?.title).toBe('ai.smithery/smithery-notion');
  });
});

describe('entries Reklu must not offer', () => {
  it('skips a server with no remote endpoint', () => {
    /*
     * A local server is an npx process. Reklu connects over HTTP and does not
     * run other people's code on its own machine — offering one would be a row
     * that cannot work, and the reason it cannot is the isolation rule.
     */
    expect(readEntry(entry({ remotes: undefined }))).toBeUndefined();
    expect(readEntry(entry({ remotes: [] }))).toBeUndefined();
  });

  it('skips a remote that is not https', () => {
    // A credential would travel in clear text to reach it.
    expect(
      readEntry(entry({ remotes: [{ type: 'streamable-http', url: 'http://example.com/mcp' }] })),
    ).toBeUndefined();
  });

  it('skips a transport Reklu does not speak', () => {
    expect(
      readEntry(entry({ remotes: [{ type: 'stdio', url: 'https://example.com/mcp' }] })),
    ).toBeUndefined();
  });

  it('skips a superseded version', () => {
    /* The registry returns every version; older ones duplicate a newer row. */
    const old = {
      ...entry(),
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: false } },
    };
    expect(readEntry(old)).toBeUndefined();
  });

  it('skips a server that has been withdrawn', () => {
    const gone = {
      ...entry(),
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted', isLatest: true } },
    };
    expect(readEntry(gone)).toBeUndefined();
  });

  it('skips an entry with no name at all', () => {
    expect(readEntry({ server: {} })).toBeUndefined();
    expect(readEntry({})).toBeUndefined();
  });
});
