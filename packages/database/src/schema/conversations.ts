/**
 * Conversations and messages.
 *
 * One conversation table serves Chat, Research, Build, Compare and Agent
 * (distinguished by `mode`) because they share history, branching, attachments
 * and artifacts. Splitting them per surface is exactly the feature-silo failure
 * spec §121 warns against.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { conversationModeEnum, messageRoleEnum } from './enums';
import { users } from './identity';
import { projects } from './projects';
import { workspaces } from './tenancy';

export const conversations = pgTable(
  'conversations',
  {
    id: primaryId('conversation'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null for an ad-hoc chat not yet filed into a project. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title'),
    /** True until a model-generated title replaces the placeholder. */
    titleIsAuto: boolean('title_is_auto').notNull().default(true),
    mode: conversationModeEnum('mode').notNull().default('chat'),

    /** Null means Reklu Auto picks per turn. */
    modelKey: text('model_key'),
    /** Compare Mode: the 2–4 models this conversation fans out to (spec §13). */
    compareModelKeys: jsonb('compare_model_keys').$type<string[]>().notNull().default([]),

    /** Skills active for this conversation, resolved at send time. */
    skillIds: jsonb('skill_ids').$type<string[]>().notNull().default([]),

    /**
     * Branching (spec §14). A branch is a new conversation rooted at the message
     * it diverged from, so the original history stays immutable.
     */
    parentConversationId: text('parent_conversation_id'),
    branchedFromMessageId: text('branched_from_message_id'),

    isFavorite: boolean('is_favorite').notNull().default(false),
    archivedAt: tsColumn('archived_at'),
    lastMessageAt: tsColumn('last_message_at'),
    messageCount: integer('message_count').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('conversations_workspace_idx').on(table.workspaceId),
    index('conversations_user_recent_idx').on(table.userId, table.lastMessageAt),
    index('conversations_project_idx').on(table.projectId),
    index('conversations_mode_idx').on(table.workspaceId, table.mode),
    index('conversations_deleted_idx').on(table.deletedAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: primaryId('message'),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    role: messageRoleEnum('role').notNull(),

    /**
     * Ordered content parts rather than a single string: a turn can interleave
     * text, tool calls, tool results, reasoning, and citations, and the renderer
     * needs that structure preserved.
     */
    content: jsonb('content').$type<unknown[]>().notNull().default([]),
    /** Flattened text, for search and for cheap context assembly. */
    contentText: text('content_text'),

    /** Which model produced this turn. Null for user messages. */
    modelKey: text('model_key'),
    /**
     * Compare Mode fans one user turn out to several assistant turns; they share
     * a `compareGroupId` so the UI can lay them out side by side.
     */
    compareGroupId: text('compare_group_id'),

    /** Ordering within the conversation; gaps are allowed for inserts. */
    sequence: integer('sequence').notNull(),

    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    finishReason: text('finish_reason'),

    /** Set when generation failed, so the UI can offer a real retry. */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    /** Populated when a user edits and regenerates a prompt. */
    editedAt: tsColumn('edited_at'),
    /** Artifacts produced by this turn. */
    artifactIds: jsonb('artifact_ids').$type<string[]>().notNull().default([]),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('messages_conversation_sequence_idx').on(table.conversationId, table.sequence),
    index('messages_conversation_idx').on(table.conversationId),
    index('messages_workspace_idx').on(table.workspaceId),
    index('messages_compare_group_idx').on(table.compareGroupId),
  ],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: primaryId('attachment'),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** References files.id; the file itself is the durable, indexed record. */
    fileId: text('file_id').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('message_attachments_unique_idx').on(table.messageId, table.fileId),
    index('message_attachments_file_idx').on(table.fileId),
  ],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [conversations.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [conversations.projectId], references: [projects.id] }),
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  attachments: many(messageAttachments),
}));

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
  message: one(messages, { fields: [messageAttachments.messageId], references: [messages.id] }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
