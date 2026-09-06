import { describe, expect, it } from 'vitest';
import { PLANS } from '../seed/data';

describe('the initial Reklu credit plan catalog', () => {
  it('matches the approved monthly prices and included credits', () => {
    expect(
      PLANS.map((plan) => ({
        key: plan.key,
        monthlyUsd: Number(plan.priceMonthlyUsd),
        credits: plan.limits.aiUnitsPerMonth,
      })),
    ).toEqual([
      { key: 'free', monthlyUsd: 0, credits: 30 },
      { key: 'plus', monthlyUsd: 19, credits: 550 },
      { key: 'pro', monthlyUsd: 39, credits: 1_150 },
      { key: 'builder', monthlyUsd: 79, credits: 2_350 },
      { key: 'max', monthlyUsd: 149, credits: 4_450 },
      { key: 'team', monthlyUsd: 299, credits: 8_950 },
    ]);
  });

  it('keeps the catalog editable through data rather than feature code', () => {
    for (const plan of PLANS) {
      expect(plan.limits.allowedModelKeys).toBeDefined();
      expect(plan.limits.features).toBeDefined();
      expect(plan.limits.buildProjectsMax).not.toBeUndefined();
      expect(plan.limits.workspaceMembersMax).not.toBeUndefined();
    }
  });
});
