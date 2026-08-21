import 'server-only';
import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import {
  agentRuns,
  aiModels,
  aiProviders,
  artifacts,
  auditLogs,
  buildProjects,
  conversations,
  db,
  jobs,
  messages,
  payments,
  plans,
  type PlanLimits,
  researchSessions,
  sessions,
  skills,
  subscriptions,
  toolExecutions,
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
  /** Needed to correct a plan by hand when a payment did not apply. */
  readonly workspaceId: string | null;
  readonly planKey: string | null;
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
      workspaceId: workspaces.id,
      planKey: plans.key,
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
        planKey: plans.key,
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
  readonly description: string | null;
  readonly priceMonthlyUsd: string;
  readonly priceYearlyUsd: string;
  readonly yearlyEnabled: boolean;
  readonly billingPeriodDays: number;
  readonly currency: string;
  readonly isPublic: boolean;
  readonly isPurchasable: boolean;
  /** Set once the plan exists in Whop; null until it has been synced. */
  readonly whopPlanId: string | null;
  readonly whopPlanIdYearly: string | null;
  readonly whopSyncedAt: Date | null;
  readonly whopSyncError: string | null;
  readonly subscribers: number;
  /** What this plan allows, so the editor can show and change it. */
  readonly limits: PlanLimits;
}

export async function listPlans(): Promise<PlanRow[]> {
  const rows = await db
    .select({
      id: plans.id,
      key: plans.key,
      name: plans.name,
      description: plans.description,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      priceYearlyUsd: plans.priceYearlyUsd,
      yearlyEnabled: plans.yearlyEnabled,
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      isPublic: plans.isPublic,
      isPurchasable: plans.isPurchasable,
      whopPlanId: plans.whopPlanId,
      whopPlanIdYearly: plans.whopPlanIdYearly,
      whopSyncedAt: plans.whopSyncedAt,
      whopSyncError: plans.whopSyncError,
      limits: plans.limits,
      subscribers: sql<number>`count(${subscriptions.id})`,
    })
    .from(plans)
    .leftJoin(subscriptions, eq(subscriptions.planId, plans.id))
    .groupBy(
      plans.id,
      plans.key,
      plans.name,
      plans.description,
      plans.priceMonthlyUsd,
      plans.priceYearlyUsd,
      plans.yearlyEnabled,
      plans.billingPeriodDays,
      plans.currency,
      plans.isPublic,
      plans.isPurchasable,
      plans.whopPlanId,
      plans.whopPlanIdYearly,
      plans.whopSyncedAt,
      plans.whopSyncError,
      plans.limits,
      plans.sortOrder,
    )
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

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * What Reklu can honestly report.
 *
 * There is no page-view collector, no referrer and no visitor tracking — the
 * product records what people *did*, not what they browsed. So "traffic" here
 * means real activity: turns taken, features used, money spent. Inventing
 * pageviews from server logs would be a different, weaker number wearing a
 * familiar name.
 */

export interface FeatureUsage {
  readonly feature: string;
  readonly total: number;
  readonly last7: number;
}

export async function featureUsage(): Promise<FeatureUsage[]> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const pairs = [
    ['Conversations', conversations, conversations.createdAt],
    ['Messages', messages, messages.createdAt],
    ['Artifacts', artifacts, artifacts.createdAt],
    ['Research runs', researchSessions, researchSessions.createdAt],
    ['Agent runs', agentRuns, agentRuns.createdAt],
    ['Build projects', buildProjects, buildProjects.createdAt],
    ['Skills', skills, skills.createdAt],
    ['Tool calls', toolExecutions, toolExecutions.createdAt],
  ] as const;

  return Promise.all(
    pairs.map(async ([feature, table, column]) => {
      const [all] = await db.select({ value: count() }).from(table);
      const [recent] = await db.select({ value: count() }).from(table).where(gte(column, weekAgo));
      return { feature, total: all?.value ?? 0, last7: recent?.value ?? 0 };
    }),
  );
}

export interface ModelShare {
  readonly modelKey: string;
  readonly calls: number;
  readonly costUsd: number;
}

/** Which models the platform actually leans on. */
export async function modelShare(days = 30): Promise<ModelShare[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      modelKey: usageLedger.modelKey,
      calls: count(),
      costUsd: sql<string>`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, since))
    .groupBy(usageLedger.modelKey)
    .orderBy(desc(count()));

  return rows.map((row) => ({
    modelKey: row.modelKey ?? 'unknown',
    calls: Number(row.calls),
    costUsd: Number(row.costUsd),
  }));
}

export interface DailyCost {
  readonly day: string;
  readonly costUsd: number;
}

export async function dailyCost(days = 30): Promise<DailyCost[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${usageLedger.createdAt})::date::text`,
      costUsd: sql<string>`coalesce(sum(${usageLedger.estimatedCostUsd}), 0)`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.createdAt, since))
    .groupBy(sql`date_trunc('day', ${usageLedger.createdAt})`);

  const byDay = new Map<string, number>();
  for (let index = days - 1; index >= 0; index--) {
    byDay.set(new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    if (byDay.has(row.day)) byDay.set(row.day, Number(row.costUsd));
  }

  return [...byDay.entries()].map(([day, costUsd]) => ({ day, costUsd }));
}

export interface Retention {
  readonly totalUsers: number;
  readonly activeToday: number;
  readonly active7: number;
  readonly active30: number;
  readonly neverReturned: number;
}

/**
 * How many people come back.
 *
 * `neverReturned` counts accounts whose only activity was the day they signed
 * up — the number that matters most early, and the one a raw signup count
 * hides.
 */
export async function retention(): Promise<Retention> {
  const day = new Date(Date.now() - 86_400_000);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const month = new Date(Date.now() - 30 * 86_400_000);

  const [total] = await db.select({ value: count() }).from(users);
  const [today] = await db.select({ value: count() }).from(users).where(gte(users.lastSeenAt, day));
  const [seven] = await db.select({ value: count() }).from(users).where(gte(users.lastSeenAt, week));
  const [thirty] = await db.select({ value: count() }).from(users).where(gte(users.lastSeenAt, month));

  const [bounced] = await db
    .select({ value: count() })
    .from(users)
    .where(
      or(
        sql`${users.lastSeenAt} is null`,
        sql`${users.lastSeenAt} < ${users.createdAt} + interval '1 day'`,
      ),
    );

  return {
    totalUsers: total?.value ?? 0,
    activeToday: today?.value ?? 0,
    active7: seven?.value ?? 0,
    active30: thirty?.value ?? 0,
    neverReturned: bounced?.value ?? 0,
  };
}

export interface ErrorRate {
  readonly label: string;
  readonly failed: number;
  readonly total: number;
}

/** Where things are breaking, as counts rather than a vague health colour. */
export async function errorRates(): Promise<ErrorRate[]> {
  const [jobRows, toolRows, runRows] = await Promise.all([
    db.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status),
    db
      .select({ status: toolExecutions.status, n: count() })
      .from(toolExecutions)
      .groupBy(toolExecutions.status),
    db.select({ status: agentRuns.status, n: count() }).from(agentRuns).groupBy(agentRuns.status),
  ]);

  const summarise = (
    label: string,
    rows: ReadonlyArray<{ status: string; n: number }>,
    failedStatuses: readonly string[],
  ): ErrorRate => ({
    label,
    failed: rows
      .filter((row) => failedStatuses.includes(row.status))
      .reduce((sum, row) => sum + Number(row.n), 0),
    total: rows.reduce((sum, row) => sum + Number(row.n), 0),
  });

  return [
    summarise('Background jobs', jobRows, ['failed']),
    summarise('Tool calls', toolRows, ['failed', 'denied', 'timed_out']),
    summarise('Agent runs', runRows, ['failed']),
  ];
}

export interface RevenueSummary {
  /** Recurring revenue implied by active subscriptions, per month. */
  readonly monthlyRecurringUsd: number;
  /** Actually collected, from recorded payments. */
  readonly collected30dUsd: number;
  readonly collectedAllTimeUsd: number;
  readonly payingWorkspaces: number;
  readonly byPlan: readonly {
    readonly key: string;
    readonly name: string;
    readonly priceMonthlyUsd: string;
    readonly subscribers: number;
    readonly monthlyRecurringUsd: number;
  }[];
}

/**
 * Revenue, separated into what is recurring and what has been collected.
 *
 * They are different numbers and conflating them flatters the figure: monthly
 * recurring is what active subscriptions imply if nobody leaves, while
 * collected is money that actually arrived. Only the second is a fact.
 */
export async function revenueSummary(): Promise<RevenueSummary> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [planRows, collected] = await Promise.all([
    db
      .select({
        key: plans.key,
        name: plans.name,
        priceMonthlyUsd: plans.priceMonthlyUsd,
        subscribers: sql<number>`count(${subscriptions.id})`,
      })
      .from(plans)
      .leftJoin(
        subscriptions,
        and(eq(subscriptions.planId, plans.id), eq(subscriptions.status, 'active')),
      )
      .groupBy(plans.id, plans.key, plans.name, plans.priceMonthlyUsd, plans.sortOrder)
      .orderBy(plans.sortOrder),
    db
      .select({
        last30: sql<number>`coalesce(sum(case when ${payments.createdAt} >= ${since} then ${payments.amountUsd} else 0 end), 0)`,
        allTime: sql<number>`coalesce(sum(${payments.amountUsd}), 0)`,
        payers: sql<number>`count(distinct ${payments.workspaceId})`,
      })
      .from(payments),
  ]);

  const byPlan = planRows.map((row) => {
    const subscribers = Number(row.subscribers);
    return {
      key: row.key,
      name: row.name,
      priceMonthlyUsd: row.priceMonthlyUsd,
      subscribers,
      monthlyRecurringUsd: subscribers * Number(row.priceMonthlyUsd),
    };
  });

  return {
    monthlyRecurringUsd: byPlan.reduce((sum, row) => sum + row.monthlyRecurringUsd, 0),
    collected30dUsd: Number(collected[0]?.last30 ?? 0),
    collectedAllTimeUsd: Number(collected[0]?.allTime ?? 0),
    payingWorkspaces: Number(collected[0]?.payers ?? 0),
    byPlan,
  };
}
