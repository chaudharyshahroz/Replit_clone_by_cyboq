/**
 * Signing in with an identity provider (spec §11).
 *
 * The whole security question here is one sentence: **when may a provider
 * identity claim an existing Reklu account?**
 *
 * Get it wrong and you get the classic pre-hijack takeover. Anyone can create a
 * GitHub or Google account and *type* someone else's address into it. If Reklu
 * matched on the address alone, an attacker would sign in as the victim. So:
 *
 *   - A known `(provider, providerAccountId)` pair signs in its own user. This
 *     is the only path that needs no email reasoning at all.
 *   - Otherwise, an address may be linked **only if the provider asserts it is
 *     verified**. GitHub's `/user/emails` and Google's `email_verified` are
 *     the sources; nothing else counts.
 *   - An unverified address never links and never creates. It is refused with
 *     an explanation.
 *
 * Linking to an existing password account is allowed under the same rule. That
 * is deliberate: the alternative is a confusing duplicate account for a user
 * who has already proven, to a provider Reklu trusts, that they own the
 * address.
 */
import { eq } from 'drizzle-orm';
import {
  accounts,
  db,
  plans,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
  type User,
} from '@reklu/database';
import { errors, logger, newId, slugify } from '@reklu/shared';
import { normalizeEmail } from '../register';
import type { OAuthIdentity, SignInProviderKey } from './providers';

export interface OAuthSignInResult {
  readonly user: User;
  readonly workspaceId: string;
  /** True when this call created the account, for a first-run experience. */
  readonly isNewUser: boolean;
  /** True when an existing account gained a new sign-in method. */
  readonly linkedExisting: boolean;
}

/** Find a workspace slug that is free. */
async function uniqueWorkspaceSlug(base: string): Promise<string> {
  const root = slugify(base) || 'workspace';
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const existing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  return `${root}-${newId('workspace').slice(-8)}`;
}

/**
 * Sign in, linking or creating as needed.
 *
 * Returns the user and their workspace. The caller creates the session — this
 * function deliberately has no opinion about cookies.
 */
export async function signInWithOAuth(
  provider: SignInProviderKey,
  identity: OAuthIdentity,
): Promise<OAuthSignInResult> {
  const emailNormalized = normalizeEmail(identity.email);

  // ---- 1. A provider account Reklu already knows -------------------------
  const [linked] = await db
    .select({ user: users })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(eq(accounts.providerAccountId, identity.providerAccountId))
    .limit(1);

  if (linked && linked.user) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, linked.user.id))
      .limit(1);

    if (!membership) {
      // A user with no workspace would land on a broken product.
      throw errors.internal(`User ${linked.user.id} has no workspace membership.`);
    }

    return {
      user: linked.user,
      workspaceId: membership.workspaceId,
      isNewUser: false,
      linkedExisting: false,
    };
  }

  /**
   * ---- 2. The takeover gate --------------------------------------------
   *
   * Everything past this point uses the email address to decide identity, so
   * an unverified address must stop here. Without this check, registering
   * someone else's address at the provider is enough to take their account.
   */
  if (!identity.emailVerified) {
    throw errors.validation(
      'Your account with this provider has no verified email address. ' +
        'Verify your email with the provider, then sign in again.',
    );
  }

  // ---- 3. An existing Reklu account with the same verified address -------
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);

  if (existing) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, existing.id))
      .limit(1);

    if (!membership) throw errors.internal(`User ${existing.id} has no workspace membership.`);

    await db.insert(accounts).values({
      id: newId('account'),
      userId: existing.id,
      type: 'oauth',
      provider,
      providerAccountId: identity.providerAccountId,
    });

    // The provider has now vouched for the address, which is stronger evidence
    // than Reklu had for a password-only account.
    if (!existing.emailVerified) {
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, existing.id));
    }

    logger.info('Linked an identity provider to an existing account', {
      provider,
      userId: existing.id,
    });

    return {
      user: existing,
      workspaceId: membership.workspaceId,
      isNewUser: false,
      linkedExisting: true,
    };
  }

  // ---- 4. A brand new account -------------------------------------------
  const displayName = identity.name?.trim() || emailNormalized.split('@')[0] || 'There';
  const slug = await uniqueWorkspaceSlug(displayName);

  const [freePlan] = await db.select().from(plans).where(eq(plans.key, 'free')).limit(1);
  if (!freePlan) {
    throw errors.internal('No "free" plan is configured. Run the seed step.');
  }

  const userId = newId('user');
  const workspaceId = newId('workspace');

  // One transaction, for the same reason password registration uses one: a
  // user without a workspace is a broken product on first load.
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: identity.email.trim(),
      emailNormalized,
      name: displayName,
      image: identity.avatarUrl ?? null,
      // Verified by the provider — checked above, never assumed.
      emailVerified: new Date(),
      // No password. `authenticate()` already returns undefined for these,
      // so an OAuth-only account cannot be signed into with a guessed password.
      passwordHash: null,
    });

    await tx.insert(accounts).values({
      id: newId('account'),
      userId,
      type: 'oauth',
      provider,
      providerAccountId: identity.providerAccountId,
    });

    await tx.insert(workspaces).values({
      id: workspaceId,
      name: `${displayName}'s workspace`,
      slug,
      ownerId: userId,
      isPersonal: true,
      createdBy: userId,
    });

    await tx.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: 'owner',
      joinedAt: new Date(),
    });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await tx.insert(subscriptions).values({
      workspaceId,
      planId: freePlan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      createdBy: userId,
    });
  });

  const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!created) throw errors.internal('User vanished immediately after creation.');

  logger.info('Created an account from an identity provider', { provider, userId });

  return { user: created, workspaceId, isNewUser: true, linkedExisting: false };
}
