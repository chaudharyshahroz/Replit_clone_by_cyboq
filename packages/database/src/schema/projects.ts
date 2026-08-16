/**
 * Projects — Reklu's unit of persistent context (spec §16–18).
 *
 * A project is what makes "research this, then build it, then pitch it" one
 * continuous piece of work rather than three unrelated sessions. Chats, files,
 * research, artifacts, builds and deployments all hang off a project, and the
 * context assembler reads from here on every AI call.
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
import { memoryKindEnum, memorySourceEnum, projectRoleEnum, projectVisibilityEnum } from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

export const projects = pgTable(
  'projects',
  {
    id: primaryId('project'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    /** Lucide icon name — see the icon system in packages/ui. Never an emoji. */
    icon: text('icon').default('folder'),
    color: text('color'),

    /**
     * Standing instructions prepended to every AI call in this project. This is
     * user-authored content and is treated as *user* instruction, never as a
     * system instruction that could escalate privilege.
     */
    instructions: text('instructions'),

    /** Null means "use Reklu Auto". */
    preferredModelId: text('preferred_model_id'),
    /** Skills auto-attached to conversations in this project. */
    defaultSkillIds: jsonb('default_skill_ids').$type<string[]>().notNull().default([]),
    /** Enabled tool identifiers, including MCP tools. */
    enabledToolIds: jsonb('enabled_tool_ids').$type<string[]>().notNull().default([]),

    visibility: projectVisibilityEnum('visibility').notNull().default('private'),
    archivedAt: tsColumn('archived_at'),
    lastActivityAt: tsColumn('last_activity_at'),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('projects_workspace_slug_idx').on(table.workspaceId, table.slug),
    index('projects_workspace_idx').on(table.workspaceId),
    index('projects_activity_idx').on(table.workspaceId, table.lastActivityAt),
    index('projects_deleted_idx').on(table.deletedAt),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: primaryId('projectMember'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Denormalized for single-hop authorization; always equals project.workspaceId. */
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull().default('editor'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('project_members_unique_idx').on(table.projectId, table.userId),
    index('project_members_user_idx').on(table.userId),
  ],
);

/**
 * Project memory (spec §18).
 *
 * Deliberately *not* an append-only transcript. Each row is a discrete,
 * inspectable, individually removable claim, and — critically — carries the
 * source it came from. A memory that cannot cite where it came from is a
 * hallucination risk, so `sourceMessageId` / `sourceFileId` are how the UI
 * shows the user why Reklu believes something.
 */
export const projectMemories = pgTable(
  'project_memories',
  {
    id: primaryId('projectMemory'),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    kind: memoryKindEnum('kind').notNull(),
    source: memorySourceEnum('source').notNull(),
    content: text('content').notNull(),

    /** Provenance. Lets the UI answer "why does Reklu think this?". */
    sourceMessageId: text('source_message_id'),
    sourceFileId: text('source_file_id'),
    sourceResearchId: text('source_research_id'),

    /**
     * Inferred memories start unapproved and are excluded from context until a
     * user confirms them. Only `source = 'user'` memories are trusted on sight.
     */
    approvedAt: tsColumn('approved_at'),
    approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),

    embedding: vector('embedding', { dimensions: 1536 }),

    /** Model-assigned salience, used to rank when the context budget is tight. */
    importance: real('importance').notNull().default(0.5),
    /** Bumped on retrieval; supports recency/frequency-weighted recall. */
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: tsColumn('last_accessed_at'),

    /** Set for time-bounded facts (e.g. "shipping deadline is Friday"). */
    expiresAt: tsColumn('expires_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('project_memories_project_idx').on(table.projectId),
    index('project_memories_kind_idx').on(table.projectId, table.kind),
    index('project_memories_approved_idx').on(table.projectId, table.approvedAt),
    index('project_memories_deleted_idx').on(table.deletedAt),
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  members: many(projectMembers),
  memories: many(projectMemories),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

export const projectMemoriesRelations = relations(projectMemories, ({ one }) => ({
  project: one(projects, { fields: [projectMemories.projectId], references: [projects.id] }),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type ProjectMemory = typeof projectMemories.$inferSelect;
export type NewProjectMemory = typeof projectMemories.$inferInsert;
