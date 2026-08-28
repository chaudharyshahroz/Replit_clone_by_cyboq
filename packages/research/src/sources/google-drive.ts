/**
 * The user's own Drive, as a source Reklu can read.
 *
 * A connector that connects and does nothing is a dead button, and this is what
 * keeps the Google one from being that. Connecting is not the feature; being
 * able to answer a question out of somebody's own documents is.
 *
 * Read-only throughout, because the grant is read-only. Nothing here can change
 * or delete a file, and that is a property of the scope rather than of this
 * code being careful.
 */
import { accessTokenFor } from '@reklu/integrations';
import { logger } from '@reklu/shared';
import type { DiscoveredSource, SourceAdapter } from '../types';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const TIMEOUT_MS = 15_000;

/** What Drive returns that is worth reading as text. */
const EXPORTABLE: Readonly<Record<string, string>> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

const READABLE = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly webViewLink?: string;
  readonly modifiedTime?: string;
}

/**
 * Escape a term for Drive's query language.
 *
 * A quote in the query closes the string and the rest becomes syntax, so a
 * search for a document about `the "big" launch` is a 400 rather than a result.
 */
function quote(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function readText(fileId: string, mimeType: string, token: string): Promise<string | undefined> {
  const exportAs = EXPORTABLE[mimeType];
  const url = exportAs
    ? `${FILES}/${fileId}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `${FILES}/${fileId}?alt=media`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;

    const text = await response.text();
    /*
     * Capped. A document can be a hundred pages, and what reaches a model is
     * charged for — the passage ranker only needs enough to find the part that
     * answers the question.
     */
    return text.slice(0, 40_000);
  } catch {
    return undefined;
  }
}

/**
 * Search a connected Drive.
 *
 * Built per request rather than once, because the connection belongs to a
 * workspace and the token behind it is refreshed on read. A cached adapter
 * would hold somebody else's Drive, which is the worst possible bug in a
 * feature like this.
 */
export function createGoogleDriveAdapter(params: {
  readonly connectionId: string;
  readonly workspaceId: string;
}): SourceAdapter {
  return {
    kind: 'connection',
    isConfigured: () => true,

    async search(query: string, limit: number): Promise<readonly DiscoveredSource[]> {
      try {
        const token = await accessTokenFor(params.connectionId, params.workspaceId);

        const url = new URL(FILES);
        /* Trashed files are not results; somebody deleted them on purpose. */
        url.searchParams.set('q', `fullText contains '${quote(query)}' and trashed = false`);
        url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime)');
        url.searchParams.set('pageSize', String(Math.min(limit, 20)));
        url.searchParams.set('orderBy', 'modifiedTime desc');
        /* Files shared with them are theirs to search too. */
        url.searchParams.set('supportsAllDrives', 'true');
        url.searchParams.set('includeItemsFromAllDrives', 'true');

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          logger.debug('Drive refused a search', { status: response.status });
          return [];
        }

        const payload = (await response.json()) as { files?: DriveFile[] };
        const files = (payload.files ?? []).filter(
          (file) => EXPORTABLE[file.mimeType] || READABLE.has(file.mimeType),
        );

        return Promise.all(
          files.map(async (file) => {
            const content = await readText(file.id, file.mimeType, token);

            return {
              kind: 'connection' as const,
              url: file.webViewLink ?? null,
              title: file.name,
              snippet: content ? content.slice(0, 300) : null,
              domain: 'drive.google.com',
              foundByQuery: query,
              ...(content ? { localContent: content } : {}),
            };
          }),
        );
      } catch (error) {
        /*
         * A source that cannot be reached is not a research run that should
         * fail. The web adapter and the workspace adapter still have answers,
         * and a revoked connection is an ordinary thing rather than an error.
         */
        logger.debug('Could not search Drive', {
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },
  };
}
