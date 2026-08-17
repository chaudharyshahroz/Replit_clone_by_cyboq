/**
 * Whether this deployment can take payment, and how.
 *
 * Every absent piece is named, because "billing unavailable" tells an operator
 * nothing they can act on (spec §25).
 */
import { loadServerEnv } from '@reklu/shared';

export const WHOP_API_BASE = 'https://api.whop.com/api/v1';
export const WHOP_CHECKOUT_SCRIPT = 'https://js.whop.com/static/checkout/loader.js';

/** Reklu plan key → Whop plan id. */
export type PayablePlanKey = 'pro' | 'team';

export interface BillingConfig {
  readonly available: boolean;
  readonly detail: string;
  readonly missing: readonly string[];
  readonly planIds: Readonly<Partial<Record<PayablePlanKey, string>>>;
  readonly canVerifyWebhooks: boolean;
}

export function billingConfig(): BillingConfig {
  const env = loadServerEnv();
  const missing: string[] = [];

  if (!env.WHOP_WEBHOOK_SECRET) missing.push('WHOP_WEBHOOK_SECRET');
  if (!env.WHOP_PLAN_ID_PRO && !env.WHOP_PLAN_ID_TEAM) {
    missing.push('WHOP_PLAN_ID_PRO or WHOP_PLAN_ID_TEAM');
  }

  const planIds: Partial<Record<PayablePlanKey, string>> = {};
  if (env.WHOP_PLAN_ID_PRO) planIds.pro = env.WHOP_PLAN_ID_PRO;
  if (env.WHOP_PLAN_ID_TEAM) planIds.team = env.WHOP_PLAN_ID_TEAM;

  return {
    available: missing.length === 0,
    detail:
      missing.length === 0
        ? 'Whop checkout is configured.'
        : `Billing is not configured. Set ${missing.join(' and ')}.`,
    missing,
    planIds,
    // The API key is optional: checkout and webhooks work without it, and it
    // is only needed to read memberships back from Whop.
    canVerifyWebhooks: Boolean(env.WHOP_WEBHOOK_SECRET),
  };
}

/** The Reklu plan a Whop plan id corresponds to, or undefined if unknown. */
export function planKeyForWhopPlan(whopPlanId: string): PayablePlanKey | undefined {
  const { planIds } = billingConfig();
  if (planIds.pro === whopPlanId) return 'pro';
  if (planIds.team === whopPlanId) return 'team';
  return undefined;
}
