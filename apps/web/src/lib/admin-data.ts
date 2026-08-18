import 'server-only';
import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import {
  aiModels,
  aiProviders,
  auditLogs,
  conversations,
  db,
  jobs,
  messages,
  plans,
  sessions,
  subscriptions,
  usageLedger,
  users,
  workspaceMembers,
  workspaces,
} from '@reklu/database';

/**
 * Read models for the admin panel (spec §78).
 *
 * Everything here is operational: counts, plans, spend, account status. None of
 * it returns the contents of a conversation or a file — that lives behind
 * `readUserContent`, which writes an audit row first.
 */

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export interface TrafficPoint {
  readonly day: string;
  readonly signups: number;
  readonly messages: number;
  readonly activeUsers: number;
}

/** Daily activity for the last N days, gap-filled so the chart has no holes. */
export async function traffic(days = 30): Promise<TrafficPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [signupRows, messageRows, activeRows] = await Promise.all([
    db
      .select({ day: sql<string>`date_trunc('day', ${users.createdAt})::date::text`, n: count() })
      .from(users)
      .where(gte(users.createdAt, since))
      .groupBy(sql`date_trunc('day', ${users.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${messages.createdAt})::date::text`, n: count() })
      .from(messages)
      .where(gte(messages.createdAt, since))
      .groupBy(sql`date_trunc('day', ${messages.createdAt})`),
    db
      .select({
        day: sql<string>`date_trunc('day', ${sessions.lastActiveAt})::date::text`,
        n: sql<number>`count(distinct ${sessions.userId})`,
      })
      .from(sessions)
      .where(gte(sessions.lastActiveAt, since))
      .groupBy(sql`date_trunc('day', ${sessions.lastActiveAt})`),
  ]);

  const byDay = new Map<string, TrafficPoint>();
  for (let index = days - 1; index >= 0; index--) {
    const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000);
    const day = date.toISOString().slice(0, 10);
    byDay.set(day, { day, signups: 0, messages: 0, activeUsers: 0 });
  }

  const merge = (day: string, patch: Partial<TrafficPoint>): void => {
    const existing = byDay.get(day);
    if (existing) byDay.set(day, { ...existing, ...patch });
  };

  for (const row of signupRows) merge(row.day, { signups: Number(row.n) });
  for (const row of messageRows) merge(row.day, { messages: Number(row.n) });
  for (const row of activeRows) merge(row.day, { activeUsers: Number(row.n) });

  return [...byDay.values()];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly isSuperAdmin: boolean;
  readonly suspendedAt: Date | null;
  readonly emailVerified: Date | null;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  readonly workspaceName: string | null;
  readonly planName: string | null;
}

export async function listUsers(params: {
  query?: string | undefined;
  limit?: number;
}): Promise<AdminUserRow[]> {
  const term = params.query?.trim();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isSuperAdmin: users.isSuperAdmin,
      suspendedAt: users.suspendedAt,
      emailVerified: users.emailVerified,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
      workspaceName: workspaces.name,
      planName: plans.name,
    })
    .from(users)
    .leftJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .leftJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      term
        ? or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`))
        : undefined,
    )
    .orderBy(desc(users.createdAt))
    .limit(params.limit ?? 50);

  return rows;
}

export interface UserDetail extends AdminUserRow {
  readonly workspaceId: string | null;
  readonly conversationCount: number;
  readonly messageCount: number;
  readonly usageUnits30d: number;
  readonly costUsd30d: number;
}

export async function getUserDetail(userId: string): Promise<UserDetail | undefined> {
  const [base] = await listUsers({ limit: 1, query: undefined }).then(() =>
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isSuperAdmin: users.isSuperAdmin,
        suspendedAt: users.suspendedAt,
        emailVerified: users.emailVerified,
        lastSeenAt: users.lastSeenAt,
        createdAt: users.createdAt,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        planName: plans.name,
      })
      .from(users)
      .leftJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .leftJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(users.id, userId))
      .limit(1),
  );

  if (!base) return undefined;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [conversationCount] = await db
    .select({ value: count() })
    .from(conversations)
    .where(eq(conversations.userId, userId));

  const [messageCount] = await db
    .select({ value: count() })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(conversations.userId, userId));

  const [spend] = await db
    .select({
      units: sql<string>`coalesce(sum(${usageLedger.billableUnits}), 0)`,
      cost: sql<string>`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`,
    })
    .from(usageLedger)
    .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, since)));

  return {
    ...base,
    conversationCount: conversationCount?.value ?? 0,
    messageCount: messageCount?.value ?? 0,
    usageUnits30d: Number(spend?.units ?? 0),
    costUsd30d: Number(spend?.cost ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface PlanRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyUsd: string;
  readonly isPublic: boolean;
  readonly subscribers: number;
}

export async function listPlans(): Promise<PlanRow[]> {
  const rows = await db
    .select({
      id: plans.id,
      key: plans.key,
      name: plans.name,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      isPublic: plans.isPublic,
      subscribers: sql<number>`count(${subscriptions.id})`,
    })
    .from(plans)
    .leftJoin(subscriptions, eq(subscriptions.planId, plans.id))
    .groupBy(plans.id, plans.key, plans.name, plans.priceMonthlyUsd, plans.isPublic, plans.sortOrder)
    .orderBy(plans.sortOrder);

  return rows.map((row) => ({ ...row, subscribers: Number(row.subscribers) }));
}

export interface SpendRow {
  readonly modelKey: string | null;
  readonly operation: string;
  readonly calls: number;
  readonly units: number;
  readonly costUsd: number;
}

/** Where the money actually goes, by model and operation. */
export async function spendBreakdown(days = 30): Promise<SpendRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      modelKey: usageLedger.modelKey,
      operation: usageLedger.operation,
      calls: count(),
      units: sql<string>`coalesce(sum(${usageLedger.billableUnits}), 0)`,
      costUsd: sql<string>`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, since))
    .groupBy(usageLedger.modelKey, usageLedger.operation)
    .orderBy(desc(sql`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`))
    .limit(30);

  return rows.map((row) => ({
    modelKey: row.modelKey,
    operation: row.operation,
    calls: Number(row.calls),
    units: Number(row.units),
    costUsd: Number(row.costUsd),
  }));
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface ModelRow {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly providerKey: string;
  readonly providerEnabled: boolean;
  readonly enabled: boolean;
  readonly costTier: string;
  readonly inputCostPerMillion: string;
  readonly outputCostPerMillion: string;
}

export async function listModels(): Promise<ModelRow[]> {
  return db
    .select({
      id: aiModels.id,
      key: aiModels.key,
      displayName: aiModels.displayName,
      providerKey: aiProviders.key,
      providerEnabled: aiProviders.enabled,
      enabled: aiModels.enabled,
      costTier: aiModels.costTier,
      inputCostPerMillion: aiModels.inputCostPerMillion,
      outputCostPerMillion: aiModels.outputCostPerMillion,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .orderBy(aiProviders.key, aiModels.sortOrder);
}

export async function listProviders() {
  return db
    .select({
      id: aiProviders.id,
      key: aiProviders.key,
      displayName: aiProviders.displayName,
      apiKeyEnvVar: aiProviders.apiKeyEnvVar,
      enabled: aiProviders.enabled,
      maintenanceMode: aiProviders.maintenanceMode,
    })
    .from(aiProviders)
    .orderBy(aiProviders.key);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function jobHealth() {
  const rows = await db
    .select({ status: jobs.status, queue: jobs.queue, n: count() })
    .from(jobs)
    .groupBy(jobs.status, jobs.queue);

  return rows.map((row) => ({ ...row, n: Number(row.n) }));
}

/** Admin actions, newest first. The record of who looked at or changed what. */
export async function adminAuditTrail(limit = 40) {
  return db
    .select({
      id: auditLogs.id,
      actorEmail: auditLogs.actorEmail,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(eq(auditLogs.isAdminAction, true))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
