import 'server-only';
import { redirect } from 'next/navigation';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import {
  agentRuns,
  db,
  featureFlags,
  plans,
  subscriptions,
  usageLedger,
  users,
  workspaces,
} from '@reklu/database';
import { getAppContext, requireUser } from '@/lib/auth-context';

/**
 * Gate every admin surface (spec §78).
 *
 * `isSuperAdmin` is deliberately not settable through the product — it is set
 * in the database by whoever owns the deployment. A UI that can grant admin is
 * a UI that can be tricked into granting it.
 *
 * Redirects rather than throwing: a non-admin should see the product, not an
 * error page confirming an admin area exists.
 */
export async function requireSuperAdmin(): Promise<{ userId: string }> {
  /**
   * `requireUser` is called directly, with a return path.
   *
   * `getAppContext()` is cached with no arguments and used in ~20 places, so
   * threading a destination through it would change every call site. Signing
   * in on the admin host otherwise lands the operator on the product home —
   * on a host that serves nothing else, leaving them stuck.
   */
  await requireUser('/admin');
  const { user } = await getAppContext();

  const [row] = await db
    .select({ isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!row?.isSuperAdmin) redirect('/home');
  return { userId: user.id };
}

export interface PlatformStats {
  readonly users: number;
  readonly workspaces: number;
  readonly activeLast7Days: number;
  readonly agentRuns: number;
  readonly usageUnits30d: number;
  readonly estimatedCostUsd30d: number;
}

export async function platformStats(): Promise<PlatformStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [userCount] = await db.select({ value: count() }).from(users);
  const [workspaceCount] = await db.select({ value: count() }).from(workspaces);
  const [active] = await db
    .select({ value: count() })
    .from(users)
    .where(gte(users.lastSeenAt, weekAgo));
  const [runs] = await db.select({ value: count() }).from(agentRuns);

  const [usage] = await db
    .select({
      units: sql<string>`coalesce(sum(${usageLedger.billableUnits}), 0)`,
      cost: sql<string>`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, since));

  return {
    users: userCount?.value ?? 0,
    workspaces: workspaceCount?.value ?? 0,
    activeLast7Days: active?.value ?? 0,
    agentRuns: runs?.value ?? 0,
    usageUnits30d: Number(usage?.units ?? 0),
    estimatedCostUsd30d: Number(usage?.cost ?? 0),
  };
}

export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly planName: string;
  readonly createdAt: Date;
  readonly usageUnits: number;
}

/** Workspaces by current-period usage, so the expensive ones are visible. */
export async function topWorkspaces(limit = 25): Promise<WorkspaceRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      planName: plans.name,
      usageUnits: sql<string>`coalesce(sum(${usageLedger.billableUnits}), 0)`,
    })
    .from(workspaces)
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .leftJoin(
      usageLedger,
      and(eq(usageLedger.workspaceId, workspaces.id), gte(usageLedger.createdAt, since)),
    )
    .groupBy(workspaces.id, workspaces.name, workspaces.createdAt, plans.name)
    .orderBy(desc(sql`coalesce(sum(${usageLedger.billableUnits}), 0)`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    planName: row.planName ?? 'Free',
    createdAt: row.createdAt,
    usageUnits: Number(row.usageUnits ?? 0),
  }));
}

export async function listFeatureFlags() {
  return db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      enabled: featureFlags.enabled,
    })
    .from(featureFlags)
    .orderBy(featureFlags.key);
}
