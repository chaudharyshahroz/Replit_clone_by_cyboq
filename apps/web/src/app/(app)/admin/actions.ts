'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { desc, eq } from 'drizzle-orm';
import {
  aiModels,
  aiProviders,
  auditLogs,
  conversations,
  db,
  featureFlags,
  messages,
  plans,
  users,
} from '@reklu/database';
import { logger, newId } from '@reklu/shared';
import { requireSuperAdmin } from '@/lib/admin';

export interface AdminActionState {
  readonly error?: string;
  readonly notice?: string;
}

/**
 * Record an admin action before it happens.
 *
 * Written first, not after: an action that fails is still an action someone
 * attempted, and a trail that only shows successes cannot answer "who tried
 * to read this?".
 */
async function audit(params: {
  actorId: string;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, unknown>;
}): Promise<void> {
  const headerList = await headers();

  await db.insert(auditLogs).values({
    id: newId('auditLog'),
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    isAdminAction: true,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    changes: params.changes ?? {},
    // Behind a proxy the direct socket address is the proxy's.
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent') ?? null,
  });
}

async function actor(): Promise<{ id: string; email: string | null }> {
  const { userId } = await requireSuperAdmin();
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { id: userId, email: row?.email ?? null };
}

// ---------------------------------------------------------------------------
// User control
// ---------------------------------------------------------------------------

export async function setUserSuspended(
  userId: string,
  suspended: boolean,
  reason?: string,
): Promise<AdminActionState> {
  const me = await actor();

  // Suspending yourself would lock the operator out of their own platform.
  if (userId === me.id && suspended) {
    return { error: 'You cannot suspend your own account.' };
  }

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: suspended ? 'user.suspend' : 'user.reinstate',
    resourceType: 'user',
    resourceId: userId,
    changes: { reason: reason ?? null },
  });

  await db
    .update(users)
    .set({
      suspendedAt: suspended ? new Date() : null,
      suspendedReason: suspended ? (reason ?? 'Suspended by an administrator.') : null,
    })
    .where(eq(users.id, userId));

  revalidatePath('/admin', 'layout');
  return { notice: suspended ? 'Account suspended.' : 'Account reinstated.' };
}

/**
 * Grant or revoke super admin.
 *
 * Deliberately refuses to remove the last admin: a platform with no
 * administrator cannot be administered, and the fix would be a manual SQL
 * statement at the worst possible moment.
 */
export async function setSuperAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<AdminActionState> {
  const me = await actor();

  if (!isAdmin) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true));

    if (admins.length <= 1) {
      return { error: 'This is the only administrator. Promote someone else first.' };
    }
  }

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: isAdmin ? 'user.grant_admin' : 'user.revoke_admin',
    resourceType: 'user',
    resourceId: userId,
  });

  await db.update(users).set({ isSuperAdmin: isAdmin }).where(eq(users.id, userId));
  revalidatePath('/admin', 'layout');
  return { notice: isAdmin ? 'Administrator granted.' : 'Administrator revoked.' };
}

// ---------------------------------------------------------------------------
// AI control
// ---------------------------------------------------------------------------

export async function setProviderEnabled(
  providerId: string,
  enabled: boolean,
): Promise<AdminActionState> {
  const me = await actor();

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: enabled ? 'provider.enable' : 'provider.disable',
    resourceType: 'ai_provider',
    resourceId: providerId,
  });

  await db.update(aiProviders).set({ enabled }).where(eq(aiProviders.id, providerId));
  revalidatePath('/admin', 'layout');
  return { notice: enabled ? 'Provider enabled.' : 'Provider disabled.' };
}

export async function setModelEnabled(
  modelId: string,
  enabled: boolean,
): Promise<AdminActionState> {
  const me = await actor();

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: enabled ? 'model.enable' : 'model.disable',
    resourceType: 'ai_model',
    resourceId: modelId,
  });

  await db.update(aiModels).set({ enabled }).where(eq(aiModels.id, modelId));
  revalidatePath('/admin', 'layout');
  return { notice: enabled ? 'Model enabled.' : 'Model disabled.' };
}

// ---------------------------------------------------------------------------
// Plans and flags
// ---------------------------------------------------------------------------

export async function setPlanPublic(
  planId: string,
  isPublic: boolean,
): Promise<AdminActionState> {
  const me = await actor();

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: isPublic ? 'plan.publish' : 'plan.hide',
    resourceType: 'plan',
    resourceId: planId,
  });

  // Hiding a plan removes it from pricing; existing subscribers keep it.
  await db.update(plans).set({ isPublic }).where(eq(plans.id, planId));
  revalidatePath('/admin', 'layout');
  return { notice: isPublic ? 'Plan is public.' : 'Plan hidden from pricing.' };
}

export async function setFeatureFlag(key: string, enabled: boolean): Promise<AdminActionState> {
  const me = await actor();

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: enabled ? 'flag.enable' : 'flag.disable',
    resourceType: 'feature_flag',
    resourceId: key,
  });

  await db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, key));
  revalidatePath('/admin', 'layout');
  return { notice: `Flag ${key} is now ${enabled ? 'on' : 'off'}.` };
}

// ---------------------------------------------------------------------------
// User content — the gated path
// ---------------------------------------------------------------------------

export interface UserContentResult {
  readonly error?: string;
  readonly conversations?: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
    readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  }>;
}

/**
 * Read a user's conversations.
 *
 * Separated from every other admin query and audited on the way in, because
 * this is the one place the panel reads private content rather than
 * operational facts. Support work sometimes needs it; it should never be
 * something that happens without a record.
 *
 * The reason is required. An audit row that says "an admin looked" is far less
 * useful six months later than one that says why.
 */
export async function readUserContent(
  userId: string,
  reason: string,
): Promise<UserContentResult> {
  const me = await actor();

  if (reason.trim().length < 10) {
    return { error: 'Give a reason of at least 10 characters. It is recorded in the audit log.' };
  }

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: 'user.read_content',
    resourceType: 'user',
    resourceId: userId,
    changes: { reason: reason.trim() },
  });

  logger.warn('An administrator read a user\'s conversations', {
    actorId: me.id,
    subjectId: userId,
  });

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.createdAt))
    .limit(10);

  const withMessages = await Promise.all(
    rows.map(async (conversation) => {
      const turns = await db
        .select({ role: messages.role, contentText: messages.contentText })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(messages.sequence)
        .limit(20);

      return {
        id: conversation.id,
        // An untitled conversation is normal; the placeholder keeps the type
        // honest rather than pushing a null into the UI.
        title: conversation.title ?? 'Untitled',
        createdAt: conversation.createdAt.toISOString(),
        messages: turns.map((turn) => ({
          role: turn.role,
          // Truncated: support needs the gist, not a transcript to keep.
          text: (turn.contentText ?? '').slice(0, 600),
        })),
      };
    }),
  );

  return { conversations: withMessages };
}
