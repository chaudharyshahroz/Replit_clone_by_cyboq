/**
 * The universal artifact system (spec §19–20).
 *
 * A document, a deck, an image, a generated app and a research report are all
 * artifacts. One table with a discriminating `type` — rather than a table per
 * output kind — is what lets "turn this research into a presentation" be a
 * transformation between two rows instead of an integration between two
 * features.
 */
import { relations } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps } from './_shared';
import { artifactStatusEnum, artifactTypeEnum } from './enums';
import { users } from './identity';
import { projects } from './projects';
import { workspaces } from './tenancy';

export const artifacts = pgTable(
  'artifacts',
  {
    id: primaryId('artifact'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),

    type: artifactTypeEnum('type').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: artifactStatusEnum('status').notNull().default('draft'),

    /** Points at the current artifact_versions row. */
    currentVersionId: text('current_version_id'),
    versionCount: integer('version_count').notNull().default(0),

    /** Provenance — which conversation, message, or research produced this. */
    sourceConversationId: text('source_conversation_id'),
    sourceMessageId: text('source_message_id'),
    sourceResearchId: text('source_research_id'),
    /**
     * Set when this artifact was derived from another (research → deck).
     * Makes the "research leads to execution" chain traceable.
     */
    derivedFromArtifactId: text('derived_from_artifact_id'),

    /** Type-specific settings: slide theme, document format, image aspect ratio. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    isFavorite: boolean('is_favorite').notNull().default(false),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('artifacts_workspace_idx').on(table.workspaceId),
    index('artifacts_project_idx').on(table.projectId),
    index('artifacts_type_idx').on(table.workspaceId, table.type),
    index('artifacts_conversation_idx').on(table.sourceConversationId),
    uniqueIndex('artifacts_project_slug_idx').on(table.projectId, table.slug),
    index('artifacts_deleted_idx').on(table.deletedAt),
  ],
);

/**
 * Immutable versions. Every AI edit appends rather than overwrites, so an
 * unhelpful model change can always be reverted (spec §33).
 */
export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: primaryId('artifactVersion'),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    version: integer('version').notNull(),

    /**
     * Inline content for text-shaped artifacts (documents as markdown, decks and
     * diagrams as structured JSON). Binary artifacts leave this null and use
     * `storageKey`.
     */
    content: jsonb('content').$type<unknown>(),
    contentText: text('content_text'),
    storageKey: text('storage_key'),

    /** Human-readable summary of what changed, shown in version history. */
    changeSummary: text('change_summary'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** The model that produced this revision, when AI-authored. */
    modelKey: text('model_key'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('artifact_versions_unique_idx').on(table.artifactId, table.version),
    index('artifact_versions_artifact_idx').on(table.artifactId),
  ],
);

export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [artifacts.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [artifacts.projectId], references: [projects.id] }),
  versions: many(artifactVersions),
}));

export const artifactVersionsRelations = relations(artifactVersions, ({ one }) => ({
  artifact: one(artifacts, { fields: [artifactVersions.artifactId], references: [artifacts.id] }),
}));

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
