import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, files, type FileRecord, type User } from '@reklu/database';
import { errors, logger, newId } from '@reklu/shared';
import {
  buildKey,
  storage,
  StorageError,
  validateUpload,
  workspaceIdFromKey,
} from '@reklu/storage';

/**
 * File ingestion.
 *
 * Order matters and is deliberate: validate the *bytes* before anything is
 * written, so a rejected upload never reaches storage or the database.
 */

/** Types whose text is extracted synchronously at upload time. */
const INLINE_TEXT_CATEGORIES = new Set(['text', 'code']);
/** Extraction is capped: a 50MB log file should not become a 50MB prompt. */
const MAX_EXTRACTED_CHARS = 200_000;

export interface UploadInput {
  readonly user: User;
  readonly workspaceId: string;
  readonly projectId?: string | null;
  readonly filename: string;
  readonly declaredType?: string | undefined;
  readonly buffer: Buffer;
  readonly maxBytes: number;
}

export async function ingestFile(input: UploadInput): Promise<FileRecord> {
  // 1. Validate content before touching storage or the database.
  let validated;
  try {
    validated = validateUpload({
      buffer: input.buffer,
      filename: input.filename,
      declaredType: input.declaredType,
      maxBytes: input.maxBytes,
    });
  } catch (error) {
    if (error instanceof StorageError) {
      if (error.code === 'TOO_LARGE') {
        throw errors.payloadTooLarge(Math.round(input.maxBytes / 1_048_576));
      }
      throw errors.validation(error.message);
    }
    throw error;
  }

  if (validated.mismatch) {
    // Not fatal — browsers get this wrong innocently — but worth recording,
    // since a deliberate mismatch is what an attacker would send.
    logger.warn('Upload content type did not match its declared type', {
      filename: input.filename,
      declared: input.declaredType,
      detected: validated.contentType,
    });
  }

  const checksum = createHash('sha256').update(input.buffer).digest('hex');

  // 2. Deduplicate within the workspace: the same bytes uploaded twice resolve
  //    to one record rather than paying storage and embedding cost twice.
  const [existing] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.workspaceId, input.workspaceId),
        eq(files.checksum, checksum),
        isNull(files.deletedAt),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const fileId = newId('file');
  const storageKey = buildKey({
    workspaceId: input.workspaceId,
    scope: 'uploads',
    fileId,
  });

  await storage().put({
    key: storageKey,
    body: input.buffer,
    contentType: validated.contentType,
    filename: input.filename,
  });

  // 3. Extract text where we can do it synchronously and cheaply.
  const extraction = await extractText(input.buffer, validated.category, validated.contentType);

  const [record] = await db
    .insert(files)
    .values({
      id: fileId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      uploadedBy: input.user.id,
      filename: input.filename.slice(0, 255),
      storageKey,
      contentType: validated.contentType,
      declaredContentType: input.declaredType ?? null,
      sizeBytes: validated.sizeBytes,
      checksum,
      // `ready` only when the content is actually usable in context.
      status: extraction.status,
      statusDetail: extraction.detail ?? null,
      extractedText: extraction.text ?? null,
      metadata: {
        category: validated.category,
        forceDownload: validated.forceDownload,
        ...(extraction.pageCount ? { pageCount: extraction.pageCount } : {}),
      },
      ...(extraction.text ? { indexedAt: new Date() } : {}),
    })
    .returning();

  return record!;
}

interface Extraction {
  readonly status: 'ready' | 'parsing' | 'failed';
  readonly text?: string;
  readonly detail?: string;
  readonly pageCount?: number;
}

/**
 * Synchronous text extraction.
 *
 * Images need no extraction — they go to vision models as image parts. Office
 * formats are stored but report honestly that extraction is not available yet,
 * rather than silently attaching an empty document to a prompt.
 */
async function extractText(
  buffer: Buffer,
  category: string,
  contentType: string,
): Promise<Extraction> {
  if (category === 'image') {
    return { status: 'ready', detail: 'Sent to vision-capable models as an image.' };
  }

  if (INLINE_TEXT_CATEGORIES.has(category)) {
    const text = buffer.toString('utf8').slice(0, MAX_EXTRACTED_CHARS);
    return { status: 'ready', text };
  }

  if (contentType === 'application/pdf') {
    try {
      const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await extractPdfText(pdf, { mergePages: true });
      const merged = (Array.isArray(text) ? text.join('\n') : text).slice(0, MAX_EXTRACTED_CHARS);

      if (merged.trim().length === 0) {
        // A scanned PDF is images, not text. Say so instead of attaching nothing.
        return {
          status: 'ready',
          detail: 'No selectable text found — this PDF may be scanned. OCR is not available yet.',
          pageCount: totalPages,
        };
      }
      return { status: 'ready', text: merged, pageCount: totalPages };
    } catch (error) {
      logger.error('PDF extraction failed', { error });
      return { status: 'failed', detail: 'Reklu could not read the text in this PDF.' };
    }
  }

  return {
    status: 'parsing',
    detail: 'Stored. Text extraction for this format is not available yet.',
  };
}

/**
 * Load attachments for a chat turn, proving workspace ownership.
 *
 * A file id is user-supplied, so this must never return a row from another
 * workspace even if the id is valid.
 */
export async function loadAttachments(
  workspaceId: string,
  fileIds: readonly string[],
): Promise<readonly FileRecord[]> {
  if (fileIds.length === 0) return [];
  return db
    .select()
    .from(files)
    .where(
      and(
        inArray(files.id, [...fileIds]),
        eq(files.workspaceId, workspaceId),
        isNull(files.deletedAt),
      ),
    );
}

/** Authorized read for the file-serving route. */
export async function readFileForUser(
  user: User,
  workspaceIds: readonly string[],
  storageKey: string,
): Promise<{ record: FileRecord; body: Buffer } | undefined> {
  const owner = workspaceIdFromKey(storageKey);
  // The key carries its workspace, so authorization is answerable before any
  // storage call — no read happens for a workspace the user is not in.
  if (!owner || !workspaceIds.includes(owner)) return undefined;

  const [record] = await db
    .select()
    .from(files)
    .where(and(eq(files.storageKey, storageKey), isNull(files.deletedAt)))
    .limit(1);

  if (!record) return undefined;

  const object = await storage().get(storageKey);
  return { record, body: object.body };
}
