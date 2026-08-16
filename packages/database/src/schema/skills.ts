/**
 * Skills — reusable AI expertise (spec §50–54).
 *
 * A skill is deliberately more than a saved system prompt: it carries
 * instructions, worked examples, attached knowledge, a preferred model, and the
 * tools it is allowed to use. That last part matters — installing a skill must
 * not silently widen what Reklu may do to your connected systems.
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
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { skillCategoryEnum, skillVisibilityEnum } from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

export const skills = pgTable(
  'skills',
  {
    id: primaryId('skill'),
    /** Null for Reklu's built-in skills, which belong to no workspace. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    /** Invocation handle: `@research-analyst`. Unique per scope. */
    handle: text('handle').notNull(),
    description: text('description').notNull(),
    icon: text('icon').default('sparkles'),
    category: skillCategoryEnum('category').notNull().default('other'),

    /** True for skills shipped by Reklu; not editable by users, only duplicable. */
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    visibility: skillVisibilityEnum('visibility').notNull().default('private'),

    currentVersionId: text('current_version_id'),
    /** Denormalized install count for library ranking. */
    installCount: integer('install_count').notNull().default(0),
    rating: real('rating'),

    publishedAt: tsColumn('published_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('skills_workspace_handle_idx').on(table.workspaceId, table.handle),
    index('skills_category_idx').on(table.category),
    index('skills_visibility_idx').on(table.visibility),
    index('skills_builtin_idx').on(table.isBuiltIn),
    index('skills_deleted_idx').on(table.deletedAt),
  ],
);

/** Versioned so that an installed skill does not change under its users. */
export const skillVersions = pgTable(
  'skill_versions',
  {
    id: primaryId('skillVersion'),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),

    /** Treated as *user-level* instruction, never as a system instruction. */
    instructions: text('instructions').notNull(),
    /** Few-shot examples: [{ input, output }]. */
    examples: jsonb('examples').$type<unknown[]>().notNull().default([]),
    /** Inline reference knowledge available to the skill. */
    knowledge: text('knowledge'),
    /** Attached file ids, indexed like any other project knowledge. */
    fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
    /** Reusable output templates, e.g. a report or deck structure. */
    templates: jsonb('templates').$type<Record<string, unknown>>().notNull().default({}),
    /** Declared inputs the skill expects, for the test harness and UI. */
    variables: jsonb('variables').$type<unknown[]>().notNull().default([]),

    preferredModelKey: text('preferred_model_key'),
    /** Built-in tools this skill may use. */
    allowedToolNames: jsonb('allowed_tool_names').$type<string[]>().notNull().default([]),
    /**
     * MCP tools this skill requests. Surfaced at install time as an explicit
     * permission grant — installing a skill never silently widens tool access.
     */
    requestedMcpToolNames: jsonb('requested_mcp_tool_names')
      .$type<string[]>()
      .notNull()
      .default([]),

    changelog: text('changelog'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('skill_versions_unique_idx').on(table.skillId, table.version),
    index('skill_versions_skill_idx').on(table.skillId),
  ],
);

export const skillInstalls = pgTable(
  'skill_installs',
  {
    id: primaryId('skillInstall'),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    /** Pinned version. Upgrades are explicit, so behaviour cannot shift silently. */
    skillVersionId: text('skill_version_id').references(() => skillVersions.id, {
      onDelete: 'set null',
    }),
    /** MCP tools the installer actually granted, which may be fewer than requested. */
    grantedMcpToolIds: jsonb('granted_mcp_tool_ids').$type<string[]>().notNull().default([]),

    isFavorite: boolean('is_favorite').notNull().default(false),
    lastUsedAt: tsColumn('last_used_at'),
    useCount: integer('use_count').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('skill_installs_unique_idx').on(table.skillId, table.workspaceId, table.userId),
    index('skill_installs_workspace_idx').on(table.workspaceId),
    index('skill_installs_user_idx').on(table.userId),
  ],
);

export const skillsRelations = relations(skills, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [skills.workspaceId], references: [workspaces.id] }),
  author: one(users, { fields: [skills.authorId], references: [users.id] }),
  versions: many(skillVersions),
  installs: many(skillInstalls),
}));

export const skillVersionsRelations = relations(skillVersions, ({ one }) => ({
  skill: one(skills, { fields: [skillVersions.skillId], references: [skills.id] }),
}));

export const skillInstallsRelations = relations(skillInstalls, ({ one }) => ({
  skill: one(skills, { fields: [skillInstalls.skillId], references: [skills.id] }),
}));

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type SkillInstall = typeof skillInstalls.$inferSelect;
