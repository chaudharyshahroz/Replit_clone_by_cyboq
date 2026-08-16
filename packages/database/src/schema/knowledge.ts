/**
 * Files and their retrievable chunks.
 *
 * Uploaded content is *untrusted data*. It is parsed, chunked, and embedded for
 * retrieval, but it never becomes instruction — see the untrusted-content
 * boundary in docs/RESEARCH_ARCHITECTURE.md.
 */
import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { fileStatusEnum } from './enums';
import { users } from './identity';
import { projects } from './projects';
import { workspaces } from './tenancy';

export const files = pgTable(
  'files',
  {
    id: primaryId('file'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),

    /** Original name as supplied by the user. Never used as a filesystem path. */
    filename: text('filename').notNull(),
    /** Storage key. Server-generated; never derived from user input. */
    storageKey: text('storage_key').notNull(),

    /** MIME type as *detected from content*, not as claimed by the client. */
    contentType: text('content_type').notNull(),
    declaredContentType: text('declared_content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the content — deduplication and integrity. */
    checksum: text('checksum').notNull(),

    status: fileStatusEnum('status').notNull().default('uploading'),
    statusDetail: text('status_detail'),

    /** Extracted plain text, when the type supports it. */
    extractedText: text('extracted_text'),
    pageCount: integer('page_count'),
    /** Type-specific metadata: sheet names, image dimensions, PDF outline. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    /** Virtual folder path within the project, e.g. "/research/competitors". */
    folder: text('folder').notNull().default('/'),

    indexedAt: tsColumn('indexed_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('files_workspace_idx').on(table.workspaceId),
    index('files_project_idx').on(table.projectId),
    index('files_status_idx').on(table.status),
    // Same bytes uploaded twice into one workspace resolve to one record.
    uniqueIndex('files_workspace_checksum_idx').on(table.workspaceId, table.checksum),
    index('files_deleted_idx').on(table.deletedAt),
  ],
);

export const fileChunks = pgTable(
  'file_chunks',
  {
    id: primaryId('fileChunk'),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),

    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),

    /**
     * Dimension is fixed in DDL, so changing EMBEDDING_MODEL to one with a
     * different width requires a migration and a re-index. Documented in
     * .env.example rather than silently truncating vectors.
     */
    embedding: vector('embedding', { dimensions: 1536 }),

    /** Locators for citation: page number, sheet, heading path, line range. */
    locator: jsonb('locator').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('file_chunks_file_index_idx').on(table.fileId, table.chunkIndex),
    index('file_chunks_workspace_idx').on(table.workspaceId),
    index('file_chunks_project_idx').on(table.projectId),
  ],
);

export const filesRelations = relations(files, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [files.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [files.projectId], references: [projects.id] }),
  chunks: many(fileChunks),
}));

export const fileChunksRelations = relations(fileChunks, ({ one }) => ({
  file: one(files, { fields: [fileChunks.fileId], references: [files.id] }),
}));

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
export type FileChunk = typeof fileChunks.$inferSelect;
