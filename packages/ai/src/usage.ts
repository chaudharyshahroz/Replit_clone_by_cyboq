/**
 * Cost accounting (spec §74).
 *
 * Every provider call writes an `ai_requests` row and a `usage_ledger` row, so
 * a bill can be explained line by line and a quota can be answered by summation.
 *
 * Money is computed in integer micro-dollars and only converted to a decimal
 * string at the boundary — accumulating float dollars across millions of rows
 * drifts, and a usage ledger that disagrees with the invoice is worse than no
 * ledger.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  aiRequests,
  db,
  plans,
  subscriptions,
  usageLedger,
  type PlanLimits,
} from '@reklu/database';
import { logger } from '@reklu/shared';
import type { RegisteredModel } from './registry';
import type { TokenUsage } from './types';

const MICROS_PER_USD = 1_000_000;

/** Provider cost in micro-dollars. Rates are per million tokens. */
export function costMicros(model: RegisteredModel, usage: TokenUsage): number {
  const input = usage.inputTokens * model.inputCostPerMillion;
  const output = usage.outputTokens * model.outputCostPerMillion;
  // Reasoning tokens are billed at the output rate by every current provider.
  const reasoning = usage.reasoningTokens * model.outputCostPerMillion;
  return Math.round(input + output + reasoning);
}

export const microsToUsdString = (micros: number): string =>
  (micros / MICROS_PER_USD).toFixed(6);

/**
 * Billable units charged against a plan quota.
 *
 * Decoupled from raw provider cost on purpose: users should not need to reason
 * about token prices, and Reklu must be able to re-price without changing what
 * a customer's quota means. One unit ≈ a standard-tier turn.
 */
const TIER_WEIGHT: Record<RegisteredModel['costTier'], number> = {
  economy: 0.25,
  standard: 1,
  premium: 4,
};

export function billableUnits(model: RegisteredModel, usage: TokenUsage): number {
  if (model.isDevelopmentMock) return 0;
  const tokens = usage.inputTokens + usage.outputTokens + usage.reasoningTokens;
  const units = (tokens / 1_000) * TIER_WEIGHT[model.costTier];
  return Math.max(0.01, Math.round(units * 100) / 100);
}

export interface RecordUsageInput {
  readonly workspaceId: string;
  readonly userId: string | null;
  readonly projectId?: string | null;
  readonly conversationId?: string | null;
  readonly messageId?: string | null;
  readonly model: RegisteredModel;
  readonly usage: TokenUsage;
  readonly kind: 'chat' | 'research' | 'build' | 'embedding' | 'agent' | 'image' | 'video';
  readonly operation: string;
  readonly autoRouted: boolean;
  readonly routingReason?: string | null;
  readonly latencyMs?: number | null;
  readonly timeToFirstTokenMs?: number | null;
  readonly status?: 'succeeded' | 'failed' | 'cancelled';
  readonly errorCode?: string | null;
  readonly requestId?: string | null;
  /** Set when the call originated in a background job, so spend is traceable to it. */
  readonly jobId?: string | null;
  readonly periodStart: Date;
}

/**
 * Write both records.
 *
 * Deliberately never throws: losing an answer the user already received because
 * the accounting insert failed is the wrong trade. A failure here is logged
 * loudly for reconciliation instead.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const micros = costMicros(input.model, input.usage);
  const units = billableUnits(input.model, input.usage);

  try {
    await db.transaction(async (tx) => {
      const [request] = await tx
        .insert(aiRequests)
        .values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          projectId: input.projectId ?? null,
          conversationId: input.conversationId ?? null,
          messageId: input.messageId ?? null,
          modelKey: input.model.key,
          providerKey: input.model.providerKey,
          kind: input.kind,
          autoRouted: input.autoRouted,
          routingReason: input.routingReason ?? null,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          reasoningTokens: input.usage.reasoningTokens,
          cachedInputTokens: input.usage.cachedInputTokens,
          estimatedCostUsd: microsToUsdString(micros),
          latencyMs: input.latencyMs ?? null,
          timeToFirstTokenMs: input.timeToFirstTokenMs ?? null,
          status: input.status ?? 'succeeded',
          errorCode: input.errorCode ?? null,
          requestId: input.requestId ?? null,
          jobId: input.jobId ?? null,
        })
        .returning({ id: aiRequests.id });

      await tx.insert(usageLedger).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        projectId: input.projectId ?? null,
        kind: input.kind,
        operation: input.operation,
        providerKey: input.model.providerKey,
        modelKey: input.model.key,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        estimatedCostUsd: microsToUsdString(micros),
        billableUnits: units.toFixed(4),
        periodStart: input.periodStart,
        aiRequestId: request?.id ?? null,
        jobId: input.jobId ?? null,
      });
    });
  } catch (error) {
    logger.error('Failed to record usage — reconcile manually', {
      error,
      workspaceId: input.workspaceId,
      modelKey: input.model.key,
      costUsd: microsToUsdString(micros),
    });
  }
}

export interface QuotaStatus {
  readonly used: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly exceeded: boolean;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/**
 * Current-period usage against the plan's allowance.
 *
 * Returned even when unlimited, so the UI can always explain what has been
 * consumed rather than only saying "credits finished" (spec §75).
 */
export async function checkQuota(workspaceId: string): Promise<QuotaStatus | undefined> {
  const rows = await db
    .select({
      limits: plans.limits,
      periodStart: subscriptions.currentPeriodStart,
      periodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  const limits = row.limits as PlanLimits;
  const [totals] = await db
    .select({ used: sql<string>`coalesce(sum(${usageLedger.billableUnits}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.workspaceId, workspaceId),
        gte(usageLedger.periodStart, row.periodStart),
      ),
    );

  const used = Number(totals?.used ?? 0);
  const limit = limits.aiUnitsPerMonth;

  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    exceeded: limit !== null && used >= limit,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}
