/**
 * File indexing: chunk a file's extracted text and store the chunks, with
 * embeddings when available.
 *
 * Runs synchronously for small files and is the body of the `embed_file` job
 * for large ones. Idempotent: re-indexing replaces a file's chunks rather than
 * appending duplicates, so a retried job cannot double a file's weight in
 * retrieval.
 */
import { eq } from 'drizzle-orm';
import { embedTexts, embeddingsAvailable } from '@reklu/ai';
import { db, fileChunks, files } from '@reklu/database';
import { logger, newId } from '@reklu/shared';
import { chunkText } from './chunking';

export interface IndexResult {
  readonly chunks: number;
  readonly embedded: boolean;
  readonly reason?: string;
}

export async function indexFile(fileId: string): Promise<IndexResult> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) return { chunks: 0, embedded: false, reason: 'File not found' };

  const text = file.extractedText?.trim();
  if (!text) {
    return { chunks: 0, embedded: false, reason: 'No extracted text to index' };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { chunks: 0, embedded: false, reason: 'Text produced no chunks' };
  }

  const batch = await embedTexts(chunks.map((chunk) => chunk.content));
  const embedded = batch !== undefined;

  if (!embedded && embeddingsAvailable()) {
    // Available but failed — worth a loud log, since retrieval silently
    // degrades to lexical from here.
    logger.warn('Embedding failed; chunks stored without vectors', { fileId });
  }

  await db.transaction(async (tx) => {
    // Replace rather than append: idempotent under retry.
    await tx.delete(fileChunks).where(eq(fileChunks.fileId, fileId));

    await tx.insert(fileChunks).values(
      chunks.map((chunk, position) => ({
        id: newId('fileChunk'),
        fileId,
        workspaceId: file.workspaceId,
        projectId: file.projectId,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: batch ? [...(batch.embeddings[position] ?? [])] : null,
        locator: { startOffset: chunk.startOffset, endOffset: chunk.endOffset },
      })),
    );

    await tx
      .update(files)
      .set({
        status: 'ready',
        indexedAt: new Date(),
        statusDetail: embedded
          ? null
          : 'Indexed for keyword search. Semantic search needs an embedding provider.',
      })
      .where(eq(files.id, fileId));
  });

  logger.info('File indexed', { fileId, chunks: chunks.length, embedded });
  return { chunks: chunks.length, embedded };
}
