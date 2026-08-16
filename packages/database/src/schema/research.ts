/**
 * Research sessions, sources, and citations (spec §21–26).
 *
 * Citation integrity is the point of this schema. A citation always references a
 * concrete `research_sources` row that Reklu actually retrieved, and carries the
 * specific passage it rests on. A claim without a supporting source gets no
 * citation rather than a plausible-looking one.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { researchModeEnum, researchStageEnum, sourceTypeEnum } from './enums';
import { users } from './identity';
import { projects } from './projects';
import { workspaces } from './tenancy';

export const researchSessions = pgTable(
  'research_sessions',
  {
    id: primaryId('research'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),

    query: text('query').notNull(),
    mode: researchModeEnum('mode').notNull().default('research'),

    /** Real pipeline position — never a synthetic percentage (spec §25). */
    stage: researchStageEnum('stage').notNull().default('queued'),
    stageDetail: text('stage_detail'),
    /** Ordered record of stages entered, with timestamps, for the progress UI. */
    stageHistory: jsonb('stage_history').$type<unknown[]>().notNull().default([]),

    /** Structured plan produced by the planning stage. */
    plan: jsonb('plan').$type<Record<string, unknown>>(),
    /** Search queries the planner generated. */
    queries: jsonb('queries').$type<string[]>().notNull().default([]),

    /** Final report as markdown, with inline [n] citation markers. */
    report: text('report'),
    /** Short answer for Quick Search mode. */
    answer: text('answer'),

    sourcesDiscovered: integer('sources_discovered').notNull().default(0),
    sourcesFetched: integer('sources_fetched').notNull().default(0),
    sourcesUsed: integer('sources_used').notNull().default(0),
    /**
     * Retrieval failures are recorded, not hidden, so the UI can say
     * "14 of 18 sources retrieved" honestly (spec §88).
     */
    sourcesFailed: integer('sources_failed').notNull().default(0),

    /** Report artifact created from this session, if any. */
    artifactId: text('artifact_id'),
    jobId: text('job_id'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completedAt: tsColumn('completed_at'),
    cancelledAt: tsColumn('cancelled_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('research_workspace_idx').on(table.workspaceId),
    index('research_user_idx').on(table.userId),
    index('research_project_idx').on(table.projectId),
    index('research_stage_idx').on(table.stage),
    index('research_deleted_idx').on(table.deletedAt),
  ],
);

export const researchSources = pgTable(
  'research_sources',
  {
    id: primaryId('researchSource'),
    researchSessionId: text('research_session_id')
      .notNull()
      .references(() => researchSessions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    type: sourceTypeEnum('type').notNull().default('web'),
    url: text('url'),
    title: text('title'),
    domain: text('domain'),
    /** Publication date as reported by the source, when discoverable. */
    publishedAt: tsColumn('published_at'),
    snippet: text('snippet'),

    /**
     * Extracted main content. Always treated as untrusted data downstream:
     * it is fenced as external content and can never redefine instructions.
     */
    extractedContent: text('extracted_content'),
    /** Set when the fetch failed; the source is kept so the failure is visible. */
    fetchError: text('fetch_error'),
    retrievedAt: tsColumn('retrieved_at'),
    httpStatus: integer('http_status'),

    /** Ranking signals from the relevance and cross-validation stages. */
    relevanceScore: real('relevance_score'),
    /** Raised when other sources corroborate this one. */
    corroborationScore: real('corroboration_score'),
    /** Set when another retrieved source contradicts this one. */
    contradictedBy: jsonb('contradicted_by').$type<string[]>().notNull().default([]),

    embedding: vector('embedding', { dimensions: 1536 }),

    /** Which of the planner's queries surfaced this source. */
    foundByQuery: text('found_by_query'),
    /** Display order [1], [2], … in the report. Null if unused. */
    citationIndex: integer('citation_index'),
    ...timestamps,
  },
  (table) => [
    index('research_sources_session_idx').on(table.researchSessionId),
    index('research_sources_workspace_idx').on(table.workspaceId),
    index('research_sources_domain_idx').on(table.domain),
    uniqueIndex('research_sources_session_url_idx').on(table.researchSessionId, table.url),
  ],
);

/**
 * A specific claim in the report tied to the specific passage that supports it.
 * Storing the passage (not just the URL) is what makes hover-preview honest and
 * lets a reviewer check that the source actually says what was claimed.
 */
export const researchCitations = pgTable(
  'research_citations',
  {
    id: primaryId('researchCitation'),
    researchSessionId: text('research_session_id')
      .notNull()
      .references(() => researchSessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => researchSources.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The sentence or clause in the report this citation supports. */
    claim: text('claim').notNull(),
    /** Verbatim supporting passage from the source. */
    supportingPassage: text('supporting_passage'),
    /** Character offset of the marker within the report. */
    reportOffset: integer('report_offset'),
    citationIndex: integer('citation_index').notNull(),
    ...timestamps,
  },
  (table) => [
    index('research_citations_session_idx').on(table.researchSessionId),
    index('research_citations_source_idx').on(table.sourceId),
  ],
);

export const researchSessionsRelations = relations(researchSessions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [researchSessions.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, { fields: [researchSessions.projectId], references: [projects.id] }),
  sources: many(researchSources),
  citations: many(researchCitations),
}));

export const researchSourcesRelations = relations(researchSources, ({ one, many }) => ({
  session: one(researchSessions, {
    fields: [researchSources.researchSessionId],
    references: [researchSessions.id],
  }),
  citations: many(researchCitations),
}));

export const researchCitationsRelations = relations(researchCitations, ({ one }) => ({
  source: one(researchSources, {
    fields: [researchCitations.sourceId],
    references: [researchSources.id],
  }),
}));

export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;
export type ResearchSource = typeof researchSources.$inferSelect;
export type ResearchCitation = typeof researchCitations.$inferSelect;
