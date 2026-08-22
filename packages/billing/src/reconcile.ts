/**
 * Ask Whop what happened, instead of waiting to be told.
 *
 * Webhooks are how Reklu normally learns about a payment, and they are not
 * something a customer's plan should depend on. A delivery can be pointed at
 * the wrong URL, dropped in transit, or arrive without the metadata that says
 * whose plan to change — and every one of those looks identical from the
 * customer's side: they paid, and the app still says Free.
 *
 * This closes that gap. Reklu records every checkout session it mints, Whop
 * stamps that session's id onto the membership and the payment it creates, and
 * this reads them back and applies what it finds. Running it when someone
 * returns from checkout means the common case never needs a webhook at all.
 *
 * It is safe to run repeatedly: applying a membership is idempotent, and a
 * payment already filed is ignored by its unique index.
 */
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { checkoutSessions, db, plans, subscriptions } from '@reklu/database';
import { logger } from '@reklu/shared';
import { billingConfig } from './config';
import { setPlan, recordPayment } from './subscription';
import { grantsAccess, listMemberships, listPayments, type WhopMembership } from './whop-api';

export type ReconcileOutcome =
  /** Whop is not configured, so there is nothing to ask. */
  | 'not_configured'
  /** No checkout this workspace started is still waiting on an answer. */
  | 'nothing_pending'
  /** Whop knows of no membership for any session this workspace started. */
  | 'no_membership_yet'
  /** A membership was found and the plan now matches it. */
  | 'applied'
  /** A membership was found but names a plan Reklu cannot sell. */
  | 'unknown_plan'
  /**
   * Whop could not be read.
   *
   * Distinct from `no_membership_yet`, and the distinction matters more than
   * any other here: the first version collapsed them, so a customer who had
   * just paid was told Whop had no record of their purchase when the truth was
   * that Reklu never managed to ask.
   */
  | 'lookup_failed';

export interface ReconcileResult {
  readonly outcome: ReconcileOutcome;
  readonly planKey?: string;
  readonly detail?: string;
}

/**
 * Whether a Whop membership is this workspace's.
 *
 * Two ways, tried in order of how much they can be trusted. The session id is
 * Reklu's own record and cannot be confused with another account's. The
 * metadata is what Whop was asked to carry — less certain, since the whole
 * reason this module exists is that it sometimes does not come back — but it
 * is the only thing that can identify a purchase made before Reklu started
 * recording sessions.
 */
export function belongsToWorkspace(
  membership: Pick<WhopMembership, 'checkoutConfigurationId' | 'metadata'>,
  workspaceId: string,
  planKeyBySession: ReadonlyMap<string, string>,
): boolean {
  if (
    membership.checkoutConfigurationId !== undefined &&
    planKeyBySession.has(membership.checkoutConfigurationId)
  ) {
    return true;
  }
  return metadataWorkspaceId(membership.metadata) === workspaceId;
}

/** What a subscription looks like when deciding whether it needs rewriting. */
export interface ExistingSubscription {
  readonly planId: string;
  readonly status: string;
  readonly membershipId: string | null;
  readonly periodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
}

/**
 * Whether the stored subscription already matches what Whop reports.
 *
 * This guard is the difference between a safe check and a quota leak.
 * `setPlan` moves `currentPeriodStart` to now, which is what resets a
 * workspace's usage counters — and reconciliation runs on every return from
 * checkout and every press of the button, matching the same membership each
 * time. Without this, opening the billing page would hand out a fresh month's
 * credits.
 */
export function isUnchanged(
  existing: ExistingSubscription | undefined,
  membership: Pick<WhopMembership, 'id' | 'renewalPeriodEnd' | 'cancelAtPeriodEnd'>,
  planId: string,
): boolean {
  return (
    existing !== undefined &&
    existing.planId === planId &&
    existing.status === 'active' &&
    existing.membershipId === membership.id &&
    existing.cancelAtPeriodEnd === membership.cancelAtPeriodEnd &&
    sameInstant(existing.periodEnd, membership.renewalPeriodEnd)
  );
}

/**
 * Whether two period ends are the same moment.
 *
 * Compared to the second, because Whop and Postgres do not agree on sub-second
 * precision and a millisecond of drift would make an unchanged subscription
 * look changed on every check — which is exactly the rewrite this guards
 * against.
 */
function sameInstant(a: Date | null, b: Date | undefined): boolean {
  if (!b) return true;
  if (!a) return false;
  return Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);
}

/** The workspace a Whop object's metadata names, if it names one. */
function metadataWorkspaceId(metadata: Record<string, unknown>): string | undefined {
  const candidates = [metadata.workspace_id, metadata.workspaceId];
  return candidates.find(
    (value): value is string => typeof value === 'string' && value.startsWith('wsp_'),
  );
}

/** The Reklu plan key a Whop object's metadata names, if it names one. */
function metadataPlanKey(metadata: Record<string, unknown>): string | undefined {
  const candidates = [metadata.plan_key, metadata.planKey];
  return candidates.find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

/**
 * The Reklu plan that has been synced to a given Whop plan.
 *
 * The last resort, for a membership that carries neither a session Reklu
 * recorded nor usable metadata — bought directly in Whop's dashboard, or
 * before any of this existed.
 */
async function planKeyForWhopPlanId(whopPlanId: string | undefined): Promise<string | undefined> {
  if (!whopPlanId) return undefined;

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

/** How far back a checkout can be and still be worth asking about. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bring one workspace's plan into line with what Whop actually has.
 *
 * Only ever grants or extends what a customer already paid for — it never
 * downgrades. A membership that has lapsed is Whop's to tell Reklu about
 * through `membership.deactivated`, and treating "not in the first page of
 * results" as cancellation would remove a plan someone is still paying for.
 */
export async function reconcileWorkspaceBilling(workspaceId: string): Promise<ReconcileResult> {
  const config = billingConfig();
  if (!config.available || !config.apiKey || !config.companyId) {
    return { outcome: 'not_configured', detail: config.detail };
  }

  /* Sessions this workspace started that have never been matched to anything. */
  const pending = await db
    .select({
      id: checkoutSessions.id,
      planKey: checkoutSessions.planKey,
      createdAt: checkoutSessions.createdAt,
    })
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.workspaceId, workspaceId), isNull(checkoutSessions.reconciledAt)))
    .orderBy(desc(checkoutSessions.createdAt))
    .limit(20);

  const cutoff = Date.now() - WINDOW_MS;
  const recent = pending.filter((row) => row.createdAt.getTime() >= cutoff);
  const planKeyBySession = new Map(recent.map((row) => [row.id, row.planKey]));

  const { memberships, failure } = await listMemberships({
    apiKey: config.apiKey,
    companyId: config.companyId,
  });

  /*
   * A refusal is not an absence.
   *
   * These were collapsed into one answer, and the billing page rendered it as
   * "Whop has no completed purchase for this workspace" — shown to a customer
   * who had paid minutes earlier and could see the charge in Whop. Reklu had
   * not asked and failed to find it; Reklu had failed to ask.
   */
  if (failure) {
    logger.error('Could not read memberships while reconciling', {
      workspaceId,
      status: failure.status ?? null,
      detail: failure.detail,
    });
    return { outcome: 'lookup_failed', detail: failure.detail };
  }

  /*
   * Two ways to recognise a membership as this workspace's, tried in order of
   * how much they can be trusted.
   *
   * The session id is Reklu's own record and cannot be confused with anyone
   * else's. The metadata is what Whop was asked to carry — less certain, since
   * the whole reason this module exists is that it sometimes does not come
   * back — but it is the only thing that can identify a purchase made before
   * Reklu started recording sessions, so it is worth trying second rather than
   * leaving those customers permanently unreconciled.
   */
  const mine = memberships.filter((membership) =>
    belongsToWorkspace(membership, workspaceId, planKeyBySession),
  );

  if (mine.length === 0) {
    if (recent.length === 0) return { outcome: 'nothing_pending' };

    /*
     * Say what was actually looked at. "No completed purchase" on its own is
     * indistinguishable from a broken lookup, and that ambiguity is what let
     * this bug survive three attempts — the numbers make it obvious whether
     * Whop returned nothing at all or returned other people's memberships.
     */
    logger.warn('No membership matched a pending checkout', {
      workspaceId,
      pendingSessions: recent.map((row) => row.id),
      membershipsSeen: memberships.length,
      membershipSessions: memberships.map((row) => row.checkoutConfigurationId ?? null),
    });

    return {
      outcome: 'no_membership_yet',
      detail:
        memberships.length === 0
          ? 'Whop reported no memberships at all for this company. If the payment is visible in Whop, WHOP_COMPANY_ID here is probably a different company than the one that was paid.'
          : `Whop reported ${memberships.length} membership${memberships.length === 1 ? '' : 's'}, none matching this workspace’s checkout. Admin → Billing → diagnostics shows what each one carried.`,
    };
  }

  /*
   * Newest first from Whop, so the first match is the most recent purchase —
   * which is the one that should decide the plan if someone bought twice.
   */
  const membership = mine[0]!;
  const sessionId = membership.checkoutConfigurationId;
  const planKey =
    (sessionId ? planKeyBySession.get(sessionId) : undefined) ??
    metadataPlanKey(membership.metadata) ??
    (await planKeyForWhopPlanId(membership.planId));

  if (!planKey) {
    logger.error('Reconciled a membership that names no Reklu plan', {
      workspaceId,
      membershipId: membership.id,
      whopPlanId: membership.planId ?? null,
      metadataKeys: Object.keys(membership.metadata),
    });
    return { outcome: 'unknown_plan' };
  }

  if (!grantsAccess(membership.status)) {
    /*
     * Found, but not paid for — an abandoned or failed checkout. Left pending
     * rather than marked done, because it may still complete.
     */
    return {
      outcome: 'no_membership_yet',
      detail: `Whop reports this membership as ${membership.status}.`,
    };
  }

  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.key, planKey), eq(plans.isPurchasable, true)))
    .limit(1);

  if (!plan) {
    logger.error('Reconciled a membership for a plan Reklu cannot sell', {
      workspaceId,
      planKey,
      membershipId: membership.id,
    });
    return { outcome: 'unknown_plan', planKey };
  }

  /*
   * Only write when something actually differs.
   *
   * `setPlan` moves `currentPeriodStart` to now, which is what resets a
   * workspace's usage counters. Reconciliation runs on every return from
   * checkout and on every press of the button, and a metadata match will keep
   * matching — so re-applying an unchanged plan would hand out a fresh quota
   * each time the page was opened.
   */
  const [existing] = await db
    .select({
      planId: subscriptions.planId,
      status: subscriptions.status,
      membershipId: subscriptions.whopMembershipId,
      periodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  if (isUnchanged(existing, membership, plan.id)) {
    if (sessionId) {
      await db
        .update(checkoutSessions)
        .set({ reconciledAt: new Date() })
        .where(eq(checkoutSessions.id, sessionId));
    }
    return { outcome: 'applied', planKey, detail: 'Already up to date.' };
  }

  const applied = await setPlan({
    workspaceId,
    planKey,
    status: 'active',
    externalId: membership.id,
    periodEnd: membership.renewalPeriodEnd,
    manageUrl: membership.manageUrl,
    cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
  });

  if (!applied) {
    return { outcome: 'unknown_plan', planKey, detail: 'That workspace has no subscription row.' };
  }

  if (sessionId) {
    await db
      .update(checkoutSessions)
      .set({ reconciledAt: new Date() })
      .where(eq(checkoutSessions.id, sessionId));
  }

  /*
   * The payments belonging to this membership, so the history and the card on
   * the billing page are right even if no `payment.succeeded` ever arrived.
   */
  const { payments: whopPayments } = await listPayments({
    apiKey: config.apiKey,
    companyId: config.companyId,
  });

  for (const payment of whopPayments) {
    const belongs =
      payment.membershipId === membership.id ||
      (sessionId !== undefined && payment.checkoutConfigurationId === sessionId);
    if (!belongs) continue;

    await recordPayment({
      workspaceId,
      planKey,
      data: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        card_brand: payment.cardBrand,
        card_last4: payment.cardLast4,
        payment_instrument: { display_name: payment.methodLabel },
      },
    });
  }

  logger.info('Reconciled a workspace against Whop', {
    workspaceId,
    planKey,
    membershipId: membership.id,
    status: membership.status,
  });

  return { outcome: 'applied', planKey };
}

/** Record a checkout session at the moment it is minted. */
export async function rememberCheckoutSession(params: {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly planKey: string;
  readonly period: 'monthly' | 'yearly';
  readonly whopPlanId?: string | undefined;
}): Promise<void> {
  try {
    await db
      .insert(checkoutSessions)
      .values({
        id: params.sessionId,
        workspaceId: params.workspaceId,
        planKey: params.planKey,
        period: params.period,
        whopPlanId: params.whopPlanId ?? null,
      })
      .onConflictDoNothing({ target: checkoutSessions.id });
  } catch (error) {
    /*
     * Not fatal on its own — the metadata path still works, and refusing to
     * open checkout because a bookkeeping row failed would be worse. It is
     * logged loudly because it costs the fallback that exists for when that
     * path does not.
     */
    logger.error('Could not record a checkout session', {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: params.workspaceId,
    });
  }
}

/** Whether a workspace has a subscription that renews rather than lapsing. */
export async function renewalState(workspaceId: string): Promise<{
  readonly autoRenews: boolean;
  readonly manageUrl: string | null;
  /** Whether there is a Whop membership Reklu can act on. */
  readonly hasMembership: boolean;
  /** Whether a cancellation is already scheduled for the end of the period. */
  readonly scheduledToEnd: boolean;
}> {
  const [row] = await db
    .select({
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      status: subscriptions.status,
      manageUrl: subscriptions.manageUrl,
      membershipId: subscriptions.whopMembershipId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  return {
    autoRenews:
      row !== undefined &&
      row.membershipId !== null &&
      row.status === 'active' &&
      !row.cancelAtPeriodEnd,
    manageUrl: row?.manageUrl ?? null,
    hasMembership: row?.membershipId != null,
    scheduledToEnd: row?.cancelAtPeriodEnd === true,
  };
}

/** How long after a checkout it is still worth checking automatically. */
const AUTO_WINDOW_MS = 60 * 60 * 1000;

/** The shortest gap between two automatic checks for the same session. */
const AUTO_INTERVAL_MS = 15 * 1000;

/**
 * Apply a purchase without anyone asking.
 *
 * A customer who has paid should not have to find a button and press it —
 * they will not, and being told to is the same as not being upgraded. This runs
 * on app page loads so the plan lands wherever they happen to go next.
 *
 * The cost is one indexed query on the overwhelmingly common path where nobody
 * has bought anything: without a recent unreconciled checkout it returns
 * before touching the network. When there is one, it is rate limited per
 * session so navigating quickly does not mean a Whop call per page.
 */
export async function autoReconcile(workspaceId: string): Promise<void> {
  try {
    const now = Date.now();
    const staleBefore = new Date(now - AUTO_INTERVAL_MS);

    const [due] = await db
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.workspaceId, workspaceId),
          isNull(checkoutSessions.reconciledAt),
          /* Only a checkout recent enough that someone may still be waiting on it. */
          gt(checkoutSessions.createdAt, new Date(now - AUTO_WINDOW_MS)),
          or(
            isNull(checkoutSessions.lastCheckedAt),
            lt(checkoutSessions.lastCheckedAt, staleBefore),
          ),
        ),
      )
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(1);

    if (!due) return;

    /*
     * Stamped before the call, not after. Two page loads racing would otherwise
     * both see the session as due and both call Whop.
     */
    await db
      .update(checkoutSessions)
      .set({ lastCheckedAt: new Date() })
      .where(eq(checkoutSessions.id, due.id));

    await reconcileWorkspaceBilling(workspaceId);
  } catch (error) {
    /*
     * Never fails the page. This is an automatic convenience running on every
     * navigation; a customer whose app will not load because a billing check
     * threw is worse off than one whose plan lands a moment later.
     */
    logger.warn('Automatic reconciliation failed', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
