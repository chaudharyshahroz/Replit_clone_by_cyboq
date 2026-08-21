import 'server-only';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { conversations, db, messages, projects } from '@reklu/database';
import { errors } from '@reklu/shared';
import type { User } from '@reklu/database';
import type { ChatMessage } from '@/components/chat/chat-view';

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly lastMessageAt: Date | null;
  readonly messageCount: number;
  readonly mode: string;
  readonly pinned: boolean;
  readonly projectId: string | null;
}

/** A title long enough to be useful, short enough not to break the sidebar. */
const MAX_TITLE_LENGTH = 200;

/**
 * Threads for the sidebar.
 *
 * Scoped to the signed-in user *and* the active workspace: a conversation is
 * private to its author even among workspace members, so filtering on
 * workspace alone would leak other people's chats.
 */
export async function listConversations(
  user: User,
  workspaceId: string,
  limit = 50,
): Promise<readonly ConversationSummary[]> {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      lastMessageAt: conversations.lastMessageAt,
      messageCount: conversations.messageCount,
      mode: conversations.mode,
      pinned: conversations.isFavorite,
      projectId: conversations.projectId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, user.id),
        eq(conversations.workspaceId, workspaceId),
        isNull(conversations.deletedAt),
        isNull(conversations.archivedAt),
      ),
    )
    // Pinned threads first, then most recently active.
    .orderBy(desc(conversations.isFavorite), desc(conversations.lastMessageAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title?.trim() || 'Untitled chat',
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    mode: row.mode,
    pinned: row.pinned,
    projectId: row.projectId,
  }));
}

/**
 * Load one thread for resume.
 *
 * Returns undefined rather than throwing on a foreign conversation so the
 * caller renders a 404 — confirming that someone else's conversation exists is
 * itself a disclosure.
 */
export async function loadConversation(
  user: User,
  workspaceId: string,
  conversationId: string,
): Promise<{ summary: ConversationSummary; messages: ChatMessage[] } | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, user.id),
        eq(conversations.workspaceId, workspaceId),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);

  if (!conversation) return undefined;

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      contentText: messages.contentText,
      modelKey: messages.modelKey,
      sources: messages.sources,
      feedback: messages.feedback,
      sequence: messages.sequence,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(messages.sequence);

  return {
    summary: {
      id: conversation.id,
      title: conversation.title?.trim() || 'Untitled chat',
      lastMessageAt: conversation.lastMessageAt,
      messageCount: conversation.messageCount,
      mode: conversation.mode,
      pinned: conversation.isFavorite,
      projectId: conversation.projectId,
    },
    messages: rows
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        id: row.id,
        role: row.role as 'user' | 'assistant',
        text: row.contentText ?? '',
        modelKey: row.modelKey,
        // Carried back so a reopened conversation still shows its citations.
        ...(row.sources.length > 0 ? { sources: row.sources } : {}),
        ...(row.feedback ? { feedback: row.feedback as 'up' | 'down' } : {}),
      })),
  };
}

/** Soft-delete a thread the user owns. */
export async function deleteConversation(
  user: User,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const deleted = await db
    .update(conversations)
    .set({ deletedAt: new Date(), updatedBy: user.id })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, user.id),
        eq(conversations.workspaceId, workspaceId),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({ id: conversations.id });

  if (deleted.length === 0) throw errors.notFound('Conversation', conversationId);
}

/**
 * The predicate every mutation below shares: this conversation, owned by this
 * user, in this workspace, not deleted.
 *
 * Written once because a mutation that forgets any one of these clauses is a
 * cross-tenant write, and four near-identical `and(...)` blocks is exactly
 * where that omission hides.
 */
function ownedBy(user: User, workspaceId: string, conversationId: string) {
  return and(
    eq(conversations.id, conversationId),
    eq(conversations.userId, user.id),
    eq(conversations.workspaceId, workspaceId),
    isNull(conversations.deletedAt),
  );
}

/** Rename a thread. An empty title restores the automatic one. */
export async function renameConversation(
  user: User,
  workspaceId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);

  const updated = await db
    .update(conversations)
    .set({
      title: trimmed.length > 0 ? trimmed : null,
      /*
       * A human-chosen title must survive: the auto-titler overwrites only
       * where titleIsAuto is still true, so leaving this set would let the
       * next turn discard what the user just typed.
       */
      titleIsAuto: trimmed.length === 0,
      updatedBy: user.id,
    })
    .where(ownedBy(user, workspaceId, conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) throw errors.notFound('Conversation', conversationId);
}

/** Pin or unpin a thread, which sorts it to the top of the sidebar. */
export async function setConversationPinned(
  user: User,
  workspaceId: string,
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  const updated = await db
    .update(conversations)
    .set({ isFavorite: pinned, updatedBy: user.id })
    .where(ownedBy(user, workspaceId, conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) throw errors.notFound('Conversation', conversationId);
}

/**
 * File a thread into a project, or pass null to take it out of one.
 *
 * The project is re-checked against the same workspace before the write.
 * Without that, a crafted request could file a conversation into another
 * tenant's project — the conversation's own ownership check would still pass,
 * because it is the *destination* that crosses the boundary.
 */
export async function setConversationProject(
  user: User,
  workspaceId: string,
  conversationId: string,
  projectId: string | null,
): Promise<void> {
  if (projectId !== null) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);

    if (!project) throw errors.notFound('Project', projectId);
  }

  const updated = await db
    .update(conversations)
    .set({ projectId, updatedBy: user.id })
    .where(ownedBy(user, workspaceId, conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) throw errors.notFound('Conversation', conversationId);
}

/**
 * Record whether a reply was useful.
 *
 * Scoped to the caller's own conversation, like every other mutation here: the
 * message id is the only thing the browser chooses, and it is checked against
 * the conversation the caller owns before anything is written.
 */
export async function setMessageFeedback(
  user: User,
  workspaceId: string,
  messageId: string,
  feedback: 'up' | 'down' | null,
): Promise<void> {
  const updated = await db
    .update(messages)
    .set({ feedback })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.workspaceId, workspaceId),
        isNull(messages.deletedAt),
        // Only a reply can be rated, and only inside a conversation this user
        // owns — joined rather than trusted from the request.
        eq(messages.role, 'assistant'),
        inArray(
          messages.conversationId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.userId, user.id),
                eq(conversations.workspaceId, workspaceId),
                isNull(conversations.deletedAt),
              ),
            ),
        ),
      ),
    )
    .returning({ id: messages.id });

  if (updated.length === 0) throw errors.notFound('Message', messageId);
}
