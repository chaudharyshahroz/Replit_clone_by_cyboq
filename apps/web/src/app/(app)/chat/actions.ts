'use server';

import { revalidatePath } from 'next/cache';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';
import {
  deleteConversation,
  renameConversation,
  setConversationPinned,
  setConversationProject,
} from '@/lib/conversations';

/**
 * The sidebar's per-thread menu.
 *
 * Each action re-derives the caller from the session rather than trusting a
 * workspace or user id from the client: the conversation id is the only thing
 * the browser gets to choose, and every mutation re-checks that it belongs to
 * the caller before writing.
 */
export interface ThreadActionState {
  readonly error?: string;
}

/** Shared error handling — these all fail the same way and should report it the same way. */
async function run(work: () => Promise<void>, failure: string): Promise<ThreadActionState> {
  try {
    await work();
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    logger.error(failure, { error });
    return { error: `${failure}. Please try again.` };
  }
  revalidatePath('/chat', 'layout');
  return {};
}

export async function renameThreadAction(
  conversationId: string,
  title: string,
): Promise<ThreadActionState> {
  const { user, workspace } = await getAppContext();
  return run(
    () => renameConversation(user, workspace.workspaceId, conversationId, title),
    'Could not rename the chat',
  );
}

export async function pinThreadAction(
  conversationId: string,
  pinned: boolean,
): Promise<ThreadActionState> {
  const { user, workspace } = await getAppContext();
  return run(
    () => setConversationPinned(user, workspace.workspaceId, conversationId, pinned),
    'Could not pin the chat',
  );
}

export async function moveThreadToProjectAction(
  conversationId: string,
  projectId: string | null,
): Promise<ThreadActionState> {
  const { user, workspace } = await getAppContext();
  return run(
    () => setConversationProject(user, workspace.workspaceId, conversationId, projectId),
    'Could not move the chat',
  );
}

/**
 * Deletes and returns; it does not navigate.
 *
 * Only the client knows whether the deleted thread is the one on screen, and
 * redirecting unconditionally would yank someone off the chat they are reading
 * because they tidied up a different one.
 */
export async function deleteThreadAction(conversationId: string): Promise<ThreadActionState> {
  const { user, workspace } = await getAppContext();
  return run(
    () => deleteConversation(user, workspace.workspaceId, conversationId),
    'Could not delete the chat',
  );
}
