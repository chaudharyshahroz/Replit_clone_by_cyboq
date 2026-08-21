import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { aiModels, db, plans } from '@reklu/database';
import type { PickablePlan } from '@/components/billing/plan-picker';

/**
 * The plans a customer can buy, shaped for the picker.
 *
 * One place, because the picker is opened from two — the sidebar's Upgrade and
 * the billing page — and a second copy of this mapping would eventually show
 * different prices in the two, which is the worst possible thing for the two
 * surfaces to disagree about.
 */
export async function purchasablePlans(): Promise<PickablePlan[]> {
  const [rows, modelCount] = await Promise.all([
    db
      .select({
        key: plans.key,
        name: plans.name,
        description: plans.description,
        priceMonthlyUsd: plans.priceMonthlyUsd,
        priceYearlyUsd: plans.priceYearlyUsd,
        yearlyEnabled: plans.yearlyEnabled,
        limits: plans.limits,
      })
      .from(plans)
      .where(eq(plans.isPurchasable, true))
      .orderBy(asc(plans.priceMonthlyUsd)),
    db
      .select({ total: sql<number>`count(*)` })
      .from(aiModels)
      .where(eq(aiModels.enabled, true)),
  ]);

  const totalModelCount = Number(modelCount[0]?.total ?? 0);

  return rows.map((plan) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    priceMonthlyUsd: plan.priceMonthlyUsd,
    priceYearlyUsd: plan.priceYearlyUsd,
    yearlyEnabled: plan.yearlyEnabled,
    aiUnitsPerMonth: plan.limits.aiUnitsPerMonth,
    imageGenerationsPerMonth: plan.limits.imageGenerationsPerMonth,
    deepResearchPerMonth: plan.limits.deepResearchPerMonth,
    workspaceMembersMax: plan.limits.workspaceMembersMax,
    allowedModelCount: plan.limits.allowedModelKeys.length,
    totalModelCount,
  }));
}
