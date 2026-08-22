/**
 * Cancelling and resuming, from inside Reklu.
 *
 * Sending someone to Whop to cancel is a dark pattern by omission: the place
 * you buy should be the place you stop, and making the exit harder to find
 * than the entrance is not a neutral choice. Whop remains where the card lives,
 * but the decision is made here.
 *
 * Two rules shape this module:
 *
 *   1. Cancellation takes effect at the end of the paid period, never at once.
 *      The customer bought that period; ending it early takes back something
 *      already paid for.
 *   2. Reklu's own record is only updated after Whop confirms. Writing it first
 *      would show a cancelled subscription that is still going to charge.
 */
import { eq } from 'drizzle-orm';
import { db, subscriptions } from '@reklu/database';
import { logger } from '@reklu/shared';
import { billingConfig } from './config';
import { cancelMembership, resumeMembership } from './whop-api';

export interface ChangeResult {
  readonly ok: boolean;
  readonly message: string;
  /** When the plan actually ends, once a cancellation is scheduled. */
  readonly endsAt?: Date | undefined;
}

/** The membership behind a workspace's subscription, if it has one. */
async function membershipFor(workspaceId: string): Promise<{
  membershipId: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: Date | null;
} | undefined> {
  const [row] = await db
    .select({
      membershipId: subscriptions.whopMembershipId,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      periodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  return row;
}

/**
 * Stop a workspace's plan renewing.
 *
 * Access continues until the period ends. Nothing is refunded and nothing is
 * taken away, which is why this needs no warning about losing work.
 */
export async function cancelWorkspacePlan(workspaceId: string): Promise<ChangeResult> {
  const config = billingConfig();
  if (!config.available || !config.apiKey) {
    return { ok: false, message: config.detail };
  }

  const current = await membershipFor(workspaceId);

  if (!current?.membershipId) {
    /*
     * No membership means nothing is being charged — a free plan, or a paid one
     * bought before Reklu recorded membership ids. Saying "cancelled" would
     * claim to have stopped a charge that this cannot see.
     */
    return {
      ok: false,
      message:
        'There is no active paid subscription to cancel. If you believe there is, cancel it from your Whop account and it will be reflected here.',
    };
  }

  if (current.cancelAtPeriodEnd) {
    return {
      ok: true,
      message: 'This plan is already set to end and will not renew.',
      endsAt: current.periodEnd ?? undefined,
    };
  }

  const { membership, failure } = await cancelMembership({
    apiKey: config.apiKey,
    membershipId: current.membershipId,
  });

  if (failure || !membership) {
    return {
      ok: false,
      message:
        failure?.detail ?? 'Whop did not confirm the cancellation. Nothing has been changed.',
    };
  }

  /*
   * Whop's own answer, not an assumption about it. If they report the
   * membership as still renewing, saying otherwise here would leave someone
   * expecting no charge and receiving one.
   */
  if (!membership.cancelAtPeriodEnd) {
    logger.error('Whop accepted a cancellation but did not mark the membership', {
      workspaceId,
      membershipId: current.membershipId,
      status: membership.status,
    });
    return {
      ok: false,
      message:
        'Whop accepted the request but has not marked the subscription as ending. Please check your Whop account before assuming it is cancelled.',
    };
  }

  const endsAt = membership.renewalPeriodEnd ?? current.periodEnd ?? undefined;

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      ...(endsAt ? { currentPeriodEnd: endsAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.workspaceId, workspaceId));

  logger.info('Cancelled a plan from Reklu', { workspaceId, membershipId: current.membershipId });

  return {
    ok: true,
    message: 'Your plan will not renew. You keep everything until the period ends.',
    endsAt,
  };
}

/** Undo a scheduled cancellation, while the period is still running. */
export async function resumeWorkspacePlan(workspaceId: string): Promise<ChangeResult> {
  const config = billingConfig();
  if (!config.available || !config.apiKey) {
    return { ok: false, message: config.detail };
  }

  const current = await membershipFor(workspaceId);

  if (!current?.membershipId) {
    return { ok: false, message: 'There is no subscription to resume.' };
  }

  if (!current.cancelAtPeriodEnd) {
    return { ok: true, message: 'This plan is already renewing.' };
  }

  const { membership, failure } = await resumeMembership({
    apiKey: config.apiKey,
    membershipId: current.membershipId,
  });

  if (failure || !membership) {
    return {
      ok: false,
      message: failure?.detail ?? 'Whop did not confirm the change. Nothing has been changed.',
    };
  }

  if (membership.cancelAtPeriodEnd) {
    return {
      ok: false,
      message:
        'Whop still has this subscription set to end. Please check your Whop account.',
    };
  }

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: false,
      canceledAt: null,
      status: 'active',
      ...(membership.renewalPeriodEnd ? { currentPeriodEnd: membership.renewalPeriodEnd } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.workspaceId, workspaceId));

  logger.info('Resumed a plan from Reklu', { workspaceId, membershipId: current.membershipId });

  return {
    ok: true,
    message: 'Your plan will renew as normal.',
    endsAt: membership.renewalPeriodEnd,
  };
}
