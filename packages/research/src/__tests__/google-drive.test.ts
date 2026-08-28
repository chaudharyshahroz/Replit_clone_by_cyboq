/**
 * Searching somebody's own Drive.
 *
 * A connector that connects and does nothing is a dead button. This is what
 * stops the Google one being that: connecting is not the feature, answering out
 * of somebody's own documents is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessTokenFor = vi.fn().mockResolvedValue('token-123');
vi.mock('@reklu/integrations', () => ({ accessTokenFor }));

const { createGoogleDriveAdapter } = await import('../sources/google-drive');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const adapter = () =>
  createGoogleDriveAdapter({ connectionId: 'con_1', workspaceId: 'wsp_1' });

function driveAnswers(files: unknown[], body = 'the document text') {
  fetchMock.mockImplementation(async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/files?') || url.includes('/files?q=')) {
      return { ok: true, json: async () => ({ files }) };
    }
    return { ok: true, text: async () => body };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  accessTokenFor.mockClear();
});

const doc = {
  id: 'f1',
  name: 'Launch plan',
  mimeType: 'application/vnd.google-apps.document',
  webViewLink: 'https://docs.google.com/document/d/f1',
};

describe('searching Drive', () => {
  it('returns a file with its text, so retrieval is a lookup', async () => {
    driveAnswers([doc]);

    const [result] = await adapter().search('launch', 5);

    expect(result?.title).toBe('Launch plan');
    expect(result?.kind).toBe('connection');
    expect(result?.localContent).toContain('the document text');
  });

  it('asks for a token that the connection layer refreshes', async () => {
    /* Google access tokens last an hour; the refresh lives behind this call. */
    driveAnswers([doc]);
    await adapter().search('launch', 5);

    expect(accessTokenFor).toHaveBeenCalledWith('con_1', 'wsp_1');
  });

  it('escapes a quote in the query', async () => {
    /*
     * A quote closes Drive's query string and the rest becomes syntax, so a
     * search for a document about the "big" launch is a 400 and not a result.
     */
    driveAnswers([]);
    await adapter().search(`the "big" launch's plan`, 5);

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    /* A backslash before the quote, both percent-encoded by URLSearchParams. */
    expect(requested).toContain('launch%5C%27s');
  });

  it('excludes trashed files', async () => {
    // Somebody deleted them on purpose; they are not results.
    driveAnswers([]);
    await adapter().search('launch', 5);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('trashed');
  });

  it('skips a file it cannot read as text', async () => {
    driveAnswers([{ ...doc, mimeType: 'image/png' }]);
    expect(await adapter().search('launch', 5)).toEqual([]);
  });

  it('returns nothing rather than failing the run when Drive refuses', async () => {
    /*
     * A revoked connection is ordinary. The web and workspace adapters still
     * have answers, and one source being unreachable must not lose the others.
     */
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    expect(await adapter().search('launch', 5)).toEqual([]);
  });

  it('returns nothing when there is no usable token', async () => {
    accessTokenFor.mockRejectedValueOnce(new Error('connection revoked'));
    expect(await adapter().search('launch', 5)).toEqual([]);
  });
});
