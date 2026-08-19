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
  /** Present only when configured; needed to mint checkout sessions. */
  readonly apiKey: string | undefined;
  /** The Whop company plans are created under. */
  readonly companyId: string | undefined;
  readonly planIds: Readonly<Partial<Record<PayablePlanKey, string>>>;
  readonly canVerifyWebhooks: boolean;
}

export function billingConfig(): BillingConfig {
  const env = loadServerEnv();
  const missing: string[] = [];

  /**
   * Required, not optional.
   *
   * This was listed as optional on the belief that checkout worked without it.
   * It does not: the embedded checkout can only carry Reklu's workspace id if
   * the session is minted through the API, and that call needs the key. Without
   * it a customer can pay and never be upgraded, because the webhook arrives
   * with no workspace to attach the membership to.
   */
  if (!env.WHOP_API_KEY) missing.push('WHOP_API_KEY');
  // Plans are created from Reklu's own definitions, which Whop files under a
  // company. Without it a plan cannot be brought into existence.
  if (!env.WHOP_COMPANY_ID) missing.push('WHOP_COMPANY_ID');
  if (!env.WHOP_WEBHOOK_SECRET) missing.push('WHOP_WEBHOOK_SECRET');
  /*
   * Plan ids are no longer an environment concern: plans are defined in the
   * admin panel and carry their own Whop id in the database. The env values
   * remain readable as a fallback for deployments configured before that.
   */

  const planIds: Partial<Record<PayablePlanKey, string>> = {};
  if (env.WHOP_PLAN_ID_PRO) planIds.pro = env.WHOP_PLAN_ID_PRO;
  if (env.WHOP_PLAN_ID_TEAM) planIds.team = env.WHOP_PLAN_ID_TEAM;

  return {
    apiKey: env.WHOP_API_KEY,
    companyId: env.WHOP_COMPANY_ID,
    available: missing.length === 0,
    detail:
      missing.length === 0
        ? 'Whop checkout is configured.'
        : `Billing is not configured. Set ${missing.join(' and ')}.`,
    missing,
    planIds,
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
