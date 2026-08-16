/**
 * Workspace knowledge as a research source (spec §23).
 *
 * Searches files the user has already uploaded and indexed. This adapter needs
 * **no external credential**, so research over your own documents works on an
 * instance with no search provider — and it is the path that makes "compare
 * these contracts" or "summarise what we know about X" real.
 *
 * Content is returned inline (`localContent`), so the fetch stage is a lookup
 * rather than a network call.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { embedOne, embeddingsAvailable } from '@reklu/ai';
import { cosineSimilarity, db, fileChunks, files } from '@reklu/database';
import type { DiscoveredSource, SourceAdapter } from '../types';

export interface WorkspaceAdapterOptions {
  readonly workspaceId: string;
  /** Restrict to one project, or search the whole workspace. */
  readonly projectId?: string | null;
}

export function createWorkspaceAdapter(options: WorkspaceAdapterOptions): SourceAdapter {
  return {
    kind: 'file',

    // Always available: it reads the workspace's own indexed content.
    isConfigured: () => true,

    async search(query: string, limit: number): Promise<readonly DiscoveredSource[]> {
      const scope = and(
        eq(fileChunks.workspaceId, options.workspaceId),
        options.projectId ? eq(fileChunks.projectId, options.projectId) : undefined,
        isNull(files.deletedAt),
      );

      const embedding = embeddingsAvailable() ? await embedOne(query) : undefined;

      if (embedding) {
        const similarity = cosineSimilarity(fileChunks.embedding, embedding);
        const rows = await db
          .select({
            fileId: fileChunks.fileId,
            filename: files.filename,
            content: fileChunks.content,
            similarity,
          })
          .from(fileChunks)
          .innerJoin(files, eq(fileChunks.fileId, files.id))
          .where(and(scope, sql`${fileChunks.embedding} IS NOT NULL`))
          .orderBy(desc(similarity))
          .limit(limit);

        return rows.map((row) => toSource(row.filename, row.content, row.fileId, query));
      }

      // Lexical fallback, so workspace research still works without embeddings.
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length > 2)
        .slice(0, 12);

      if (terms.length === 0) return [];

      const tsquery = terms.join(' | ');
      const rank = sql<number>`ts_rank(to_tsvector('english', ${fileChunks.content}), to_tsquery('english', ${tsquery}))`;

      const rows = await db
        .select({
          fileId: fileChunks.fileId,
          filename: files.filename,
          content: fileChunks.content,
          rank,
        })
        .from(fileChunks)
        .innerJoin(files, eq(fileChunks.fileId, files.id))
        .where(
          and(
            scope,
            sql`to_tsvector('english', ${fileChunks.content}) @@ to_tsquery('english', ${tsquery})`,
          ),
        )
        .orderBy(desc(rank))
        .limit(limit);

      return rows.map((row) => toSource(row.filename, row.content, row.fileId, query));
    },
  };
}

function toSource(
  filename: string,
  content: string,
  fileId: string,
  query: string,
): DiscoveredSource {
  return {
    kind: 'file',
    url: null,
    title: filename,
    // A short preview for the sources panel; full text travels in localContent.
    snippet: content.slice(0, 240).replace(/\s+/g, ' ').trim(),
    domain: null,
    foundByQuery: query,
    localContent: content,
    localFileId: fileId,
  };
}
