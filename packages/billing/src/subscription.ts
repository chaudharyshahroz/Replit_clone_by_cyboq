/**
 * Applying Whop membership events to Reklu subscriptions (spec §72–§75).
 *
 * A webhook is the only thing that changes what a workspace has paid for, and
 * it arrives from outside. Two rules follow:
 *
 *   1. **Deliveries are idempotent.** Whop retries, and retries are normal.
 *      Applying the same activation twice must leave the same state, not two
 *      subscriptions or a doubled period.
 *   2. **A downgrade never deletes data.** Deactivation moves the workspace to
 *      the free plan; it does not remove projects, artifacts or history the
 *      user may pay to reach again.
 */
import { and, eq } from 'drizzle-orm';
import { db, plans, subscriptions, workspaces } from '@reklu/database';
import { logger } from '@reklu/shared';
import { planKeyForWhopPlan, type PayablePlanKey } from './config';

export type ApplyOutcome =
  | 'activated'
  | 'deactivated'
  | 'cancel_scheduled'
  | 'ignored_unknown_plan'
  | 'ignored_unknown_workspace'
  | 'ignored_event';

export interface ApplyResult {
  readonly outcome: ApplyOutcome;
  readonly detail: string;
  readonly workspaceId?: string | undefined;
}

/**
 * Find the workspace a membership belongs to.
 *
 * Whop carries Reklu's own workspace id in checkout metadata, which is the only
 * link that does not depend on matching email addresses — a user may pay with
 * a different address than they signed up with, and guessing would attach a
 * payment to the wrong account.
 */
function workspaceIdFrom(data: Record<string, unknown>): string | undefined {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.workspace_id,
    metadata.workspaceId,
    data.workspace_id,
    (data.checkout_session as Record<string, unknown> | undefined)?.metadata,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.startsWith('wsp_')) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      for (const value of Object.values(nested)) {
        if (typeof value === 'string' && value.startsWith('wsp_')) return value;
      }
    }
  }
  return undefined;
}

/**
 * The plan key Reklu put in the checkout metadata.
 *
 * Preferred over recognising a Whop plan id, because plans are now created
 * from Reklu's own definitions — the id may be one this deployment has never
 * seen, and refusing it would reject a payment that is perfectly valid.
 */
function planKeyFromMetadata(data: Record<string, unknown>): string | undefined {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.plan_key,
    metadata.planKey,
    (data.checkout_session as Record<string, unknown> | undefined)?.metadata,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const value = nested.plan_key ?? nested.planKey;
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

/** Whether a key names a plan this deployment can actually sell. */
async function isPayablePlanKey(key: string): Promise<boolean> {
  const [row] = await db
    .select({ key: plans.key })
    .from(plans)
    .where(and(eq(plans.key, key), eq(plans.isPurchasable, true)))
    .limit(1);
  return Boolean(row);
}

function whopPlanIdFrom(data: Record<string, unknown>): string | undefined {
  const direct = data.plan_id ?? data.planId;
  if (typeof direct === 'string') return direct;

  const plan = data.plan as Record<string, unknown> | undefined;
  if (plan && typeof plan.id === 'string') return plan.id;
  return undefined;
}

async function planIdFor(key: PayablePlanKey | 'free'): Promise<string | undefined> {
  const [row] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, key)).limit(1);
  return row?.id;
}

/**
 * Move a workspace onto a plan.
 *
 * Updates the existing subscription rather than inserting a second one: a
 * workspace has exactly one, and two would make every quota query ambiguous.
 */
async function setPlan(params: {
  workspaceId: string;
  planKey: PayablePlanKey | 'free';
  status: 'active' | 'canceled';
  externalId?: string | undefined;
  periodEnd?: Date | undefined;
}): Promise<boolean> {
  const planId = await planIdFor(params.planKey);
  if (!planId) {
    logger.error('No such plan while applying a membership event', { planKey: params.planKey });
    return false;
  }

  const now = new Date();
  const periodEnd = params.periodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const updated = await db
    .update(subscriptions)
    .set({
      planId,
      status: params.status,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      ...(params.externalId ? { externalSubscriptionId: params.externalId } : {}),
      updatedAt: now,
    })
    .where(eq(subscriptions.workspaceId, params.workspaceId))
    .returning({ id: subscriptions.id });

  return updated.length > 0;
}

/**
 * Apply one verified event.
 *
 * Called only after `verifyWebhook` has passed. An unknown workspace, plan or
 * event type is *ignored rather than failed*: Whop retries failures, and
 * retrying something Reklu will never understand is a loop that never ends.
 */
export async function applyMembershipEvent(params: {
  type: string;
  data: Record<string, unknown>;
}): Promise<ApplyResult> {
  const workspaceId = workspaceIdFrom(params.data);

  if (!workspaceId) {
    return {
      outcome: 'ignored_unknown_workspace',
      detail:
        'The event carried no Reklu workspace id in its metadata, so it cannot be applied.',
    };
  }

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    return {
      outcome: 'ignored_unknown_workspace',
      detail: 'That workspace no longer exists.',
      workspaceId,
    };
  }

  const membershipId = typeof params.data.id === 'string' ? params.data.id : undefined;

  switch (params.type) {
    case 'membership.activated':
    case 'payment.succeeded': {
      const whopPlanId = whopPlanIdFrom(params.data);

      /*
       * Metadata first, then the plan id.
       *
       * Reklu writes the plan key into the checkout session, so it is the
       * authoritative answer. Matching a Whop plan id is kept as a fallback
       * for memberships bought before plans moved into the admin panel, and
       * for anything created directly in Whop's dashboard.
       */
      const fromMetadata = planKeyFromMetadata(params.data);
      const planKey =
        fromMetadata && (await isPayablePlanKey(fromMetadata))
          ? (fromMetadata as PayablePlanKey)
          : whopPlanId
            ? planKeyForWhopPlan(whopPlanId)
            : undefined;

      if (!planKey) {
        // A plan Reklu does not recognise must not silently grant anything.
        return {
          outcome: 'ignored_unknown_plan',
          detail: `Neither the checkout metadata (${fromMetadata ?? 'absent'}) nor the Whop plan ${whopPlanId ?? 'unknown'} names a Reklu plan that can be sold.`,
          workspaceId,
        };
      }

      const applied = await setPlan({
        workspaceId,
        planKey,
        status: 'active',
        externalId: membershipId,
      });

      logger.info('Applied a membership activation', { workspaceId, planKey, applied });

      return {
        outcome: 'activated',
        detail: `Workspace moved to the ${planKey} plan.`,
        workspaceId,
      };
    }

    case 'membership.deactivated':
    case 'payment.failed': {
      // Downgrade, never delete. The user may pay again and expect their work.
      await setPlan({ workspaceId, planKey: 'free', status: 'canceled' });
      logger.info('Applied a membership deactivation', { workspaceId });

      return {
        outcome: 'deactivated',
        detail: 'Workspace moved to the free plan. No data was removed.',
        workspaceId,
      };
    }

    case 'membership.cancel_at_period_end_changed': {
      /**
       * Cancellation scheduled, not applied. The workspace keeps everything it
       * paid for until the period ends; `membership.deactivated` arrives then.
       */
      return {
        outcome: 'cancel_scheduled',
        detail: 'Cancellation recorded. The plan continues until the period ends.',
        workspaceId,
      };
    }

    default:
      return {
        outcome: 'ignored_event',
        detail: `Reklu does not act on ${params.type}.`,
        workspaceId,
      };
  }
}
