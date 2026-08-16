/**
 * Tenancy: workspaces, membership, invitations.
 *
 * The workspace is Reklu's primary isolation boundary. Every substantive
 * resource carries `workspaceId`, and every authorization decision starts by
 * proving the caller is a member of the workspace that owns the row.
 */
import { relations } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { invitationStatusEnum, workspaceRoleEnum } from './enums';
import { users } from './identity';

export const workspaces = pgTable(
  'workspaces',
  {
    id: primaryId('workspace'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    image: text('image'),

    /**
     * Every user gets a personal workspace at sign-up so that nothing in the
     * product has to special-case "no workspace yet". Team workspaces are the
     * same shape, which is what lets a personal account grow into a team
     * without a data migration (spec §71).
     */
    isPersonal: boolean('is_personal').notNull().default(false),

    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Workspace-wide AI defaults and policy, e.g. default model, memory opt-out. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('workspaces_slug_idx').on(table.slug),
    index('workspaces_owner_idx').on(table.ownerId),
    index('workspaces_deleted_idx').on(table.deletedAt),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: primaryId('workspaceMember'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('member'),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joinedAt: tsColumn('joined_at'),
    ...timestamps,
  },
  (table) => [
    // One membership row per (workspace, user) — the uniqueness that makes
    // "is this user a member?" a single indexed lookup.
    uniqueIndex('workspace_members_unique_idx').on(table.workspaceId, table.userId),
    index('workspace_members_user_idx').on(table.userId),
    index('workspace_members_workspace_idx').on(table.workspaceId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: primaryId('invitation'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    role: workspaceRoleEnum('role').notNull().default('member'),

    /** SHA-256 of the emailed invite token; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),

    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tsColumn('expires_at').notNull(),
    acceptedAt: tsColumn('accepted_at'),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('invitations_token_idx').on(table.tokenHash),
    index('invitations_workspace_idx').on(table.workspaceId),
    index('invitations_email_idx').on(table.emailNormalized),
    index('invitations_status_idx').on(table.status),
  ],
);

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  members: many(workspaceMembers),
  invitations: many(invitations),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  workspace: one(workspaces, { fields: [invitations.workspaceId], references: [workspaces.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceRole = WorkspaceMember['role'];
export type Invitation = typeof invitations.$inferSelect;
