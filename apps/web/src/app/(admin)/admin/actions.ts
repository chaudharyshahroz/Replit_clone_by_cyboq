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
  subscriptions,
  users,
} from '@reklu/database';
import { absoluteAppUrl, isRekluError, logger, newId } from '@reklu/shared';
import { billingConfig, syncPlanToWhop } from '@reklu/billing';
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

/**
 * Create a plan.
 *
 * The key is the stable identifier everything else references — subscriptions,
 * model allowances, the checkout metadata that tells the webhook which tier was
 * bought — so it is normalised here and never editable afterwards. A plan whose
 * key changed would strand every subscription pointing at the old one.
 */
export async function createPlan(input: {
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyUsd: string;
}): Promise<AdminActionState> {
  const me = await actor();

  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (key.length === 0) return { error: 'A plan needs a key, like "pro" or "team".' };

  const name = input.name.trim();
  if (name.length === 0) return { error: 'A plan needs a name.' };

  const price = Number(input.priceMonthlyUsd);
  if (!Number.isFinite(price) || price < 0) return { error: 'Enter a price of zero or more.' };

  const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, key)).limit(1);
  if (existing) return { error: `A plan with the key "${key}" already exists.` };

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: 'plan.create',
    resourceType: 'plan',
    resourceId: key,
  });

  const [created] = await db
    .insert(plans)
    .values({
      key,
      name,
      priceMonthlyUsd: price.toFixed(2),
      priceYearlyUsd: (price * 10).toFixed(2),
      /*
       * Starts unsold and unlisted. A new plan has default limits nobody has
       * reviewed yet, and putting it on the billing page the moment it exists
       * would sell it before anyone decided what it includes.
       */
      isPurchasable: false,
      isPublic: false,
      sortOrder: 100,
      limits: {
        aiUnitsPerMonth: 30,
        deepResearchPerMonth: 5,
        buildProjectsMax: 3,
        imageGenerationsPerMonth: 10,
        videoGenerationsPerMonth: 0,
        fileUploadMaxMb: 20,
        storageMaxGb: 1,
        workspaceMembersMax: 1,
        mcpServersMax: 2,
        concurrentJobsMax: 1,
        allowedModelKeys: [],
        features: [],
      },
    })
    .returning({ id: plans.id });

  revalidatePath('/admin', 'layout');
  return {
    notice: `Created ${name}. Set its limits, then turn on "Sold on the billing page".`,
    ...(created ? {} : {}),
  };
}

/**
 * Remove a plan, or refuse when someone is on it.
 *
 * A plan with subscribers cannot be deleted: their subscription row points at
 * it, and quota checks read its limits every request. Deleting it would leave
 * paying customers on a plan that no longer exists. Retiring it — unsold and
 * unlisted — is the operation that is actually wanted, and it is offered by
 * name rather than silently substituted.
 */
export async function deletePlan(planId: string): Promise<AdminActionState> {
  const me = await actor();

  const [plan] = await db
    .select({ key: plans.key, name: plans.name })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!plan) return { error: 'No such plan.' };
  if (plan.key === 'free') {
    return { error: 'The free plan cannot be removed; every workspace falls back to it.' };
  }

  const [subscriber] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.planId, planId))
    .limit(1);

  if (subscriber) {
    return {
      error: `${plan.name} has subscribers, so it cannot be deleted. Turn off "Sold on the billing page" to retire it instead — existing subscribers keep it.`,
    };
  }

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: 'plan.delete',
    resourceType: 'plan',
    resourceId: planId,
  });

  await db.delete(plans).where(eq(plans.id, planId));
  revalidatePath('/admin', 'layout');
  return { notice: `Deleted ${plan.name}.` };
}

export async function savePlan(
  planId: string,
  input: {
    readonly name: string;
    readonly description: string;
    readonly priceMonthlyUsd: string;
    readonly priceYearlyUsd: string;
    readonly yearlyEnabled: boolean;
    readonly billingPeriodDays: number;
    readonly isPurchasable: boolean;
    readonly isPublic: boolean;
    /** null means unmetered, which is a real setting and not an empty field. */
    readonly aiUnitsPerMonth: number | null;
    readonly imageGenerationsPerMonth: number | null;
    readonly deepResearchPerMonth: number | null;
    readonly workspaceMembersMax: number | null;
    /** Empty means every enabled model. */
    readonly allowedModelKeys: readonly string[];
  },
): Promise<AdminActionState> {
  const me = await actor();

  const price = Number(input.priceMonthlyUsd);
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Enter a price of zero or more.' };
  }

  const yearly = Number(input.priceYearlyUsd);
  if (!Number.isFinite(yearly) || yearly < 0) {
    return { error: 'Enter a yearly price of zero or more.' };
  }
  if (input.yearlyEnabled && yearly <= 0 && price > 0) {
    return { error: 'A yearly option needs a yearly price.' };
  }
  if (!Number.isInteger(input.billingPeriodDays) || input.billingPeriodDays < 1) {
    return { error: 'Billing period must be a whole number of days.' };
  }
  const name = input.name.trim();
  if (name.length === 0) return { error: 'A plan needs a name.' };

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: 'plan.update',
    resourceType: 'plan',
    resourceId: planId,
  });

  /*
   * Limits are merged onto whatever the row already holds rather than replaced.
   * The form edits four of a dozen fields, and writing a fresh object would
   * silently reset the rest to whatever the form did not know about.
   */
  const [current] = await db
    .select({ limits: plans.limits })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!current) return { error: 'No such plan.' };

  await db
    .update(plans)
    .set({
      name,
      description: input.description.trim() || null,
      priceMonthlyUsd: price.toFixed(2),
      priceYearlyUsd: yearly.toFixed(2),
      yearlyEnabled: input.yearlyEnabled,
      billingPeriodDays: input.billingPeriodDays,
      isPurchasable: input.isPurchasable,
      isPublic: input.isPublic,
      limits: {
        ...current.limits,
        aiUnitsPerMonth: input.aiUnitsPerMonth,
        imageGenerationsPerMonth: input.imageGenerationsPerMonth,
        deepResearchPerMonth: input.deepResearchPerMonth,
        workspaceMembersMax: input.workspaceMembersMax,
        allowedModelKeys: [...input.allowedModelKeys],
      },
    })
    .where(eq(plans.id, planId));

  const result = await syncPlan(planId);
  revalidatePath('/admin', 'layout');
  revalidatePath('/settings/billing');
  return result;
}

/**
 * Create or refresh this plan's counterpart in Whop.
 *
 * Exposed on its own as well as from `savePlan`, so a plan that failed to sync
 * can be retried without re-entering everything.
 */
export async function syncPlan(planId: string): Promise<AdminActionState> {
  await actor();

  const config = billingConfig();
  if (!config.apiKey || !config.companyId) {
    const detail = `Cannot reach Whop: ${config.detail}`;
    await db.update(plans).set({ whopSyncError: detail }).where(eq(plans.id, planId));
    return { error: detail };
  }

  const [plan] = await db
    .select({
      key: plans.key,
      name: plans.name,
      description: plans.description,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      priceYearlyUsd: plans.priceYearlyUsd,
      yearlyEnabled: plans.yearlyEnabled,
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      isPurchasable: plans.isPurchasable,
    })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!plan) return { error: 'No such plan.' };

  // A free plan is never bought, so Whop has nothing to hold for it.
  if (!plan.isPurchasable || Number(plan.priceMonthlyUsd) <= 0) {
    await db
      .update(plans)
      .set({ whopSyncError: null, whopSyncedAt: null, whopPlanId: null })
      .where(eq(plans.id, planId));
    revalidatePath('/admin', 'layout');
    return { notice: 'Saved. This plan is not sold, so Whop needs no copy of it.' };
  }

  try {
    const { whopPlanId } = await syncPlanToWhop({
      apiKey: config.apiKey,
      companyId: config.companyId,
      returnUrl: absoluteAppUrl('/settings/billing'),
      plan: {
        key: plan.key,
        title: plan.name,
        description: plan.description,
        priceUsd: Number(plan.priceMonthlyUsd),
        billingPeriodDays: plan.billingPeriodDays,
        currency: plan.currency,
      },
    });

    /*
     * The yearly option is a second plan in Whop. A Whop plan carries one price
     * and one period, so there is no way to express both on one object — and a
     * yearly subscriber must be charged yearly, not billed monthly at a yearly
     * price.
     */
    let yearlyId: string | undefined;
    if (plan.yearlyEnabled && Number(plan.priceYearlyUsd) > 0) {
      const yearly = await syncPlanToWhop({
        apiKey: config.apiKey,
        companyId: config.companyId,
        returnUrl: absoluteAppUrl('/settings/billing'),
        plan: {
          // A distinct key, so Whop files it as its own product rather than
          // replacing the monthly one.
          key: `${plan.key}-yearly`,
          title: `${plan.name} (yearly)`,
          description: plan.description,
          priceUsd: Number(plan.priceYearlyUsd),
          billingPeriodDays: 365,
          currency: plan.currency,
        },
      });
      yearlyId = yearly.whopPlanId;
    }

    await db
      .update(plans)
      .set({
        // Only overwrite when Whop actually named a plan. Clearing a known id
        // because one response omitted it would lose the link.
        ...(whopPlanId ? { whopPlanId } : {}),
        ...(yearlyId ? { whopPlanIdYearly: yearlyId } : {}),
        whopSyncedAt: new Date(),
        whopSyncError: null,
      })
      .where(eq(plans.id, planId));

    revalidatePath('/admin', 'layout');
    return { notice: 'Saved and synced to Whop.' };
  } catch (error) {
    const detail = isRekluError(error)
      ? error.userMessage
      : 'Whop refused the plan. Check the API key permissions.';
    logger.error('Plan sync to Whop failed', { error, planId });

    await db.update(plans).set({ whopSyncError: detail }).where(eq(plans.id, planId));
    revalidatePath('/admin', 'layout');
    return { error: `Saved in Reklu, but not synced: ${detail}` };
  }
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

/**
 * Put a workspace on a plan by hand.
 *
 * A payment that succeeds in Whop but does not apply in Reklu leaves someone
 * charged and on the free tier. Whatever caused it — a webhook that never
 * arrived, metadata that did not survive the round trip — the customer should
 * not have to wait for the cause to be found. This is the correction, and it
 * is audited like every other privileged write.
 *
 * It changes what someone is entitled to without changing what they were
 * charged, so it is deliberately not exposed anywhere a customer can reach.
 */
export async function setWorkspacePlan(
  workspaceId: string,
  planKey: string,
): Promise<AdminActionState> {
  const me = await actor();

  const [plan] = await db
    .select({ id: plans.id, name: plans.name })
    .from(plans)
    .where(eq(plans.key, planKey))
    .limit(1);

  if (!plan) return { error: `No plan with the key "${planKey}".` };

  await audit({
    actorId: me.id,
    actorEmail: me.email,
    action: 'workspace.plan.set',
    resourceType: 'workspace',
    resourceId: workspaceId,
  });

  const now = new Date();
  const updated = await db
    .update(subscriptions)
    .set({
      planId: plan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    })
    .where(eq(subscriptions.workspaceId, workspaceId))
    .returning({ id: subscriptions.id });

  if (updated.length === 0) {
    return { error: 'That workspace has no subscription row to update.' };
  }

  revalidatePath('/admin', 'layout');
  return { notice: `Moved to ${plan.name}. Their quota resets from today.` };
}
