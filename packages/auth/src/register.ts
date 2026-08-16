/**
 * Account creation and sign-in.
 *
 * Registration creates the user, their personal workspace, the owner
 * membership, and a Free subscription **in one transaction**. A user who exists
 * without a workspace would hit a broken product on first load, so partial
 * success here is not acceptable.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  db,
  plans,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
  type User,
} from '@reklu/database';
import { errors, newId, slugify } from '@reklu/shared';
import { fakeVerifyDelay, hashPassword, validatePasswordStrength, verifyPassword } from './password';

/** Lowercase + trim. Uniqueness and lookup both use this form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive: the verification email is the real check. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  if (normalized.length === 0) return 'Enter your email address.';
  if (normalized.length > 320) return 'That email address is too long.';
  if (!EMAIL_SHAPE.test(normalized)) return 'Enter a valid email address.';
  return undefined;
}

/** Find a workspace slug that is free, appending a counter only if needed. */
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

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly name?: string | undefined;
}

export interface RegisterResult {
  readonly user: User;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const emailProblem = validateEmail(input.email);
  if (emailProblem) throw errors.validation(emailProblem, { email: [emailProblem] });

  const passwordProblem = validatePasswordStrength(input.password);
  if (passwordProblem) throw errors.validation(passwordProblem, { password: [passwordProblem] });

  const emailNormalized = normalizeEmail(input.email);
  const displayName = input.name?.trim() || emailNormalized.split('@')[0] || 'There';

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);

  if (existing.length > 0) {
    // Registration necessarily reveals that an address is taken. Sign-in does
    // not (see authenticate below), which is where enumeration actually matters.
    throw errors.validation('An account with this email already exists.', {
      email: ['An account with this email already exists. Try signing in instead.'],
    });
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueWorkspaceSlug(displayName);

  const freePlan = await db.select().from(plans).where(eq(plans.key, 'free')).limit(1);
  if (!freePlan[0]) {
    throw errors.internal('No "free" plan is configured. Run `pnpm db:seed`.');
  }

  const userId = newId('user');
  const workspaceId = newId('workspace');

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: input.email.trim(),
      emailNormalized,
      name: displayName,
      passwordHash,
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
      planId: freePlan[0]!.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      createdBy: userId,
    });
  });

  const created = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!created[0]) throw errors.internal('User vanished immediately after creation.');

  return { user: created[0], workspaceId, workspaceSlug: slug };
}

/**
 * Verify credentials.
 *
 * Returns undefined for every failure mode — unknown address, wrong password,
 * OAuth-only account, suspended account — and burns comparable CPU in each, so
 * the endpoint cannot be used to discover which addresses have accounts.
 */
export async function authenticate(email: string, password: string): Promise<User | undefined> {
  const emailNormalized = normalizeEmail(email);

  const found = await db
    .select()
    .from(users)
    .where(eq(users.emailNormalized, emailNormalized))
    .limit(1);

  const user = found[0];
  if (!user?.passwordHash) {
    await fakeVerifyDelay();
    return undefined;
  }

  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) return undefined;
  if (user.suspendedAt) return undefined;

  if (needsRehash) {
    // Transparently upgrade to current cost parameters on successful sign-in.
    const upgraded = await hashPassword(password);
    await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
  }

  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  return user;
}

/** The workspace to land a user in after sign-in. Personal workspace wins. */
export async function defaultWorkspaceFor(
  userId: string,
): Promise<{ id: string; slug: string; name: string } | undefined> {
  const rows = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      isPersonal: workspaces.isPersonal,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(sql`${workspaces.isPersonal} DESC, ${workspaces.createdAt} ASC`)
    .limit(1);

  const row = rows[0];
  return row ? { id: row.id, slug: row.slug, name: row.name } : undefined;
}
