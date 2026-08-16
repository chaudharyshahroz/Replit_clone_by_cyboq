import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  defaultWorkspaceFor,
  listWorkspaces,
  resolveSession,
  SESSION_COOKIE,
  type WorkspaceAccess,
} from '@reklu/auth';
import type { User } from '@reklu/database';

/**
 * Per-request session resolution.
 *
 * `cache()` dedupes within a single render pass, so a layout, a page, and three
 * components asking "who is signed in?" produce one database round-trip rather
 * than five.
 */
export const getSession = cache(async () => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

/** Signed-in user, or redirect to sign-in. */
export async function requireUser(returnTo?: string): Promise<User> {
  const session = await getSession();
  if (!session) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }
  return session.user;
}

export interface AppContext {
  readonly user: User;
  readonly workspace: WorkspaceAccess;
  readonly workspaces: readonly WorkspaceAccess[];
}

/**
 * The context every authenticated screen needs.
 *
 * A signed-in user without a workspace should be impossible — registration
 * creates one transactionally — so reaching that state means the data is
 * inconsistent and we fail loudly rather than rendering a broken shell.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const user = await requireUser();
  const [all, preferred] = await Promise.all([
    listWorkspaces(user),
    defaultWorkspaceFor(user.id),
  ]);

  const workspace = all.find((w) => w.workspaceId === preferred?.id) ?? all[0];
  if (!workspace) {
    throw new Error(
      `User ${user.id} has no workspace. Registration should have created one; ` +
        'the account is in an inconsistent state.',
    );
  }

  return { user, workspace, workspaces: all };
});
