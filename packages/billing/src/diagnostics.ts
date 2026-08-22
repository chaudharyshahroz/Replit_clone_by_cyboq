/**
 * Why a payment did or did not become a plan.
 *
 * Built after the same bug was diagnosed from guesses twice. The failure is
 * always the same from the outside — the customer paid and the app says Free —
 * and there are four quite different causes, needing four different fixes:
 *
 *   1. Whop is not sending deliveries here at all (wrong URL in their dashboard)
 *   2. Deliveries arrive but fail the signature check (wrong secret)
 *   3. Deliveries arrive and name no workspace Reklu knows (metadata lost)
 *   4. Deliveries arrive and name a plan Reklu cannot sell (plan not synced)
 *
 * Nothing in the product could tell them apart. This reads the delivery log and
 * Whop's own records side by side and says which one it is.
 */
import { desc, eq } from 'drizzle-orm';
import { checkoutSessions, db, plans, subscriptions, workspaces } from '@reklu/database';
import { billingConfig } from './config';
import { recentDeliveries, type DeliverySummary } from './delivery-log';
import { listMemberships, type WhopMembership } from './whop-api';

export interface MembershipDiagnosis {
  readonly membershipId: string;
  readonly status: string;
  readonly whopPlanId: string | undefined;
  readonly checkoutSessionId: string | undefined;
  readonly metadataKeys: readonly string[];
  /** The workspace Reklu can attach this to, if any. */
  readonly resolvedWorkspaceId: string | undefined;
  readonly resolvedWorkspaceName: string | undefined;
  readonly resolvedPlanKey: string | undefined;
  /** Plain English: what will happen to this membership, and why. */
  readonly verdict: string;
}

export interface PlanSync {
  readonly key: string;
  readonly name: string;
  readonly isPurchasable: boolean;
  readonly whopPlanId: string | null;
  readonly whopPlanIdYearly: string | null;
  readonly whopSyncError: string | null;
}

export interface BillingDiagnostics {
  readonly configured: boolean;
  readonly configDetail: string;
  readonly missingEnv: readonly string[];
  readonly deliveries: readonly DeliverySummary[];
  readonly deliveryVerdict: string;
  readonly memberships: readonly MembershipDiagnosis[];
  readonly membershipVerdict: string;
  readonly plans: readonly PlanSync[];
  readonly sessionCount: number;
  readonly reachedWhop: boolean;
}

/** What the delivery log says about whether Whop is reaching this deployment. */
export function judgeDeliveries(deliveries: readonly DeliverySummary[]): string {
  if (deliveries.length === 0) {
    return 'No webhook delivery has ever reached this deployment. Whop is not calling Reklu — check the webhook URL in Whop’s dashboard points at https://<your-domain>/api/webhooks/whop, and that the endpoint is enabled.';
  }

  const rejected = deliveries.filter((row) => row.outcome === 'rejected');
  if (rejected.length === deliveries.length) {
    return 'Every delivery was rejected before it could be read. The signature did not verify, which means WHOP_WEBHOOK_SECRET here does not match the signing secret shown for this endpoint in Whop.';
  }

  const ignored = deliveries.filter((row) => row.outcome === 'ignored');
  if (ignored.length > 0 && deliveries.every((row) => row.outcome !== 'applied')) {
    return 'Deliveries arrive and verify, but none has been applied — every one named a workspace or plan Reklu could not resolve. The rows below show which keys Whop actually sent.';
  }

  const applied = deliveries.filter((row) => row.outcome === 'applied');
  if (applied.length > 0) {
    return `Webhooks are working: ${applied.length} of the last ${deliveries.length} deliveries were applied.`;
  }

  return 'Deliveries are arriving. See the outcomes below for what happened to each.';
}

/**
 * Everything needed to tell the four causes apart.
 *
 * Whop is read live, so this reflects their records rather than Reklu's copy of
 * them — which is the point, since every one of these failures is a
 * disagreement between the two.
 */
export async function billingDiagnostics(): Promise<BillingDiagnostics> {
  const config = billingConfig();

  const [deliveries, planRows, sessions] = await Promise.all([
    recentDeliveries(25),
    db
      .select({
        key: plans.key,
        name: plans.name,
        isPurchasable: plans.isPurchasable,
        whopPlanId: plans.whopPlanId,
        whopPlanIdYearly: plans.whopPlanIdYearly,
        whopSyncError: plans.whopSyncError,
      })
      .from(plans)
      .orderBy(plans.key),
    db
      .select({ id: checkoutSessions.id, workspaceId: checkoutSessions.workspaceId, planKey: checkoutSessions.planKey })
      .from(checkoutSessions)
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(200),
  ]);

  const base = {
    configured: config.available,
    configDetail: config.detail,
    missingEnv: config.missing,
    deliveries,
    deliveryVerdict: judgeDeliveries(deliveries),
    plans: planRows,
    sessionCount: sessions.length,
  };

  if (!config.available || !config.apiKey || !config.companyId) {
    return {
      ...base,
      memberships: [],
      membershipVerdict: 'Whop cannot be read: ' + config.detail,
      reachedWhop: false,
    };
  }

  const { memberships, failure } = await listMemberships({
    apiKey: config.apiKey,
    companyId: config.companyId,
    limit: 25,
  });

  /*
   * A refusal is the answer, not an absence of one. Reporting it as "no
   * memberships" would point at the customer's purchase when the problem is
   * this deployment's API key.
   */
  if (failure) {
    return {
      ...base,
      memberships: [],
      membershipVerdict: failure.detail,
      reachedWhop: false,
    };
  }

  const sessionOwner = new Map(sessions.map((row) => [row.id, row]));
  const planByWhopId = new Map<string, string>();
  for (const plan of planRows) {
    if (plan.whopPlanId) planByWhopId.set(plan.whopPlanId, plan.key);
    if (plan.whopPlanIdYearly) planByWhopId.set(plan.whopPlanIdYearly, plan.key);
  }

  const diagnoses = await Promise.all(
    memberships.map((membership) => diagnose(membership, sessionOwner, planByWhopId)),
  );

  return {
    ...base,
    memberships: diagnoses,
    membershipVerdict: judgeMemberships(diagnoses),
    reachedWhop: true,
  };
}

export function judgeMemberships(diagnoses: readonly MembershipDiagnosis[]): string {
  if (diagnoses.length === 0) {
    return 'Whop reports no memberships for this company at all. If someone has paid, the API key may belong to a different company than the one they bought from.';
  }
  const unresolved = diagnoses.filter((row) => row.resolvedWorkspaceId === undefined);
  if (unresolved.length === diagnoses.length) {
    return 'None of Whop’s memberships can be matched to a Reklu workspace. Each row below says what it is missing.';
  }
  if (unresolved.length > 0) {
    return `${unresolved.length} of ${diagnoses.length} memberships cannot be matched to a workspace.`;
  }
  return 'Every membership Whop reports can be matched to a workspace.';
}

async function diagnose(
  membership: WhopMembership,
  sessionOwner: ReadonlyMap<string, { workspaceId: string; planKey: string }>,
  planByWhopId: ReadonlyMap<string, string>,
): Promise<MembershipDiagnosis> {
  const session = membership.checkoutConfigurationId
    ? sessionOwner.get(membership.checkoutConfigurationId)
    : undefined;

  const metadataWorkspace = [membership.metadata.workspace_id, membership.metadata.workspaceId].find(
    (value): value is string => typeof value === 'string' && value.startsWith('wsp_'),
  );

  const workspaceId = session?.workspaceId ?? metadataWorkspace;
  const planKey =
    session?.planKey ??
    (typeof membership.metadata.plan_key === 'string' ? membership.metadata.plan_key : undefined) ??
    (membership.planId ? planByWhopId.get(membership.planId) : undefined);

  let workspaceName: string | undefined;
  if (workspaceId) {
    const [row] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    workspaceName = row?.name;
  }

  return {
    membershipId: membership.id,
    status: membership.status,
    whopPlanId: membership.planId,
    checkoutSessionId: membership.checkoutConfigurationId,
    metadataKeys: Object.keys(membership.metadata),
    resolvedWorkspaceId: workspaceId,
    resolvedWorkspaceName: workspaceName,
    resolvedPlanKey: planKey,
    verdict: verdictFor({ membership, session, metadataWorkspace, workspaceId, workspaceName, planKey }),
  };
}

function verdictFor(input: {
  membership: WhopMembership;
  session: { workspaceId: string; planKey: string } | undefined;
  metadataWorkspace: string | undefined;
  workspaceId: string | undefined;
  workspaceName: string | undefined;
  planKey: string | undefined;
}): string {
  if (!input.workspaceId) {
    const missing = input.membership.checkoutConfigurationId
      ? `Whop names checkout session ${input.membership.checkoutConfigurationId}, which Reklu has no record of minting`
      : 'Whop sent no checkout session id';
    return `Cannot be matched to a workspace. ${missing}, and the metadata carries no workspace id (keys sent: ${
      Object.keys(input.membership.metadata).join(', ') || 'none'
    }).`;
  }

  if (!input.workspaceName) {
    return `Names workspace ${input.workspaceId}, which no longer exists in this database.`;
  }

  if (!input.planKey) {
    return `Belongs to ${input.workspaceName}, but names no Reklu plan — Whop plan ${
      input.membership.planId ?? 'unknown'
    } is not recorded against any plan here. Sync the plan in Admin → Billing.`;
  }

  const via = input.session ? 'a checkout session Reklu minted' : 'checkout metadata';
  return `Resolves to ${input.workspaceName} on plan "${input.planKey}", via ${via}. Status at Whop: ${input.membership.status}.`;
}
