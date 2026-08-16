import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { conversations, db, messages } from '@reklu/database';
import { errors } from '@reklu/shared';
import type { User } from '@reklu/database';
import type { ChatMessage } from '@/components/chat/chat-view';

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly lastMessageAt: Date | null;
  readonly messageCount: number;
  readonly mode: string;
}

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
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title?.trim() || 'Untitled chat',
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    mode: row.mode,
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
    },
    messages: rows
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        id: row.id,
        role: row.role as 'user' | 'assistant',
        text: row.contentText ?? '',
        modelKey: row.modelKey,
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
