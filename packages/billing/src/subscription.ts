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
import { and, eq, or } from 'drizzle-orm';
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

/**
 * Find a plan by the Whop plan id it was synced to.
 *
 * This is the fallback when checkout metadata does not survive the round trip,
 * and it has to read the database: plans are created in the admin panel and
 * carry their own Whop ids, so a lookup against the two environment variables
 * could only ever recognise Pro and Team. Anything an administrator added —
 * which is the whole point of plan management — resolved to nothing and the
 * payment was ignored.
 *
 * Both the monthly and the yearly object map back to the same plan.
 */
async function planKeyForWhopPlanId(whopPlanId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ key: plans.key })
    .from(plans)
    .where(
      and(
        eq(plans.isPurchasable, true),
        or(eq(plans.whopPlanId, whopPlanId), eq(plans.whopPlanIdYearly, whopPlanId)),
      ),
    )
    .limit(1);

  return row?.key;
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

/**
 * Plan keys are data, not a union.
 *
 * These were typed as 'pro' | 'team' | 'free' — the set that existed when
 * plans were seeded and unchangeable. Now an administrator creates them, so
 * the type has to admit whatever they named it, and the check that it exists
 * moves to the database lookup below, where it belongs.
 */
async function planIdFor(key: string): Promise<string | undefined> {
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
  planKey: string;
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

      /*
       * Three ways to name the plan, tried in order of how much they can be
       * trusted: what Reklu itself wrote into the checkout, then the plan the
       * database has synced to that Whop id, then the legacy environment
       * variables.
       */
      const planKey =
        fromMetadata && (await isPayablePlanKey(fromMetadata))
          ? fromMetadata
          : whopPlanId
            ? ((await planKeyForWhopPlanId(whopPlanId)) ?? planKeyForWhopPlan(whopPlanId))
            : undefined;

      if (!planKey) {
        /*
         * Logged with the payload's shape, not just its conclusion. Every time
         * this has fired, the question has been "what did Whop actually send?"
         * — and the answer was nowhere in the logs.
         */
        logger.error('Could not resolve a plan for a paid membership', {
          type: params.type,
          workspaceId,
          metadataPlanKey: fromMetadata ?? null,
          whopPlanId: whopPlanId ?? null,
          payloadKeys: Object.keys(params.data),
          metadataKeys: Object.keys((params.data.metadata ?? {}) as Record<string, unknown>),
        });

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
