'use server';

import { billingConfig, createCheckoutSession } from '@reklu/billing';
import { db, plans } from '@reklu/database';
import { eq } from 'drizzle-orm';
import { absoluteAppUrl, isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface CheckoutStart {
  readonly sessionId?: string;
  readonly whopPlanId?: string;
  readonly returnUrl?: string;
  readonly error?: string;
}

/**
 * Mint a checkout session for the plan picker.
 *
 * The session has to be created on the server — it carries the workspace id and
 * plan key in its metadata, which is the only link between a payment and an
 * account that does not rely on matching email addresses. Returning it lets the
 * embed open where the choice was made, instead of sending someone to another
 * page to finish what they already decided.
 */
export async function startCheckoutAction(
  planKey: string,
  period: 'monthly' | 'yearly',
): Promise<CheckoutStart> {
  const { workspace } = await getAppContext();
  const config = billingConfig();

  if (!config.available || !config.apiKey) {
    return { error: config.detail };
  }

  const [plan] = await db
    .select({
      key: plans.key,
      name: plans.name,
      description: plans.description,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      priceYearlyUsd: plans.priceYearlyUsd,
      yearlyEnabled: plans.yearlyEnabled,
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      whopPlanId: plans.whopPlanId,
      whopPlanIdYearly: plans.whopPlanIdYearly,
      isPurchasable: plans.isPurchasable,
    })
    .from(plans)
    .where(eq(plans.key, planKey))
    .limit(1);

  if (!plan || !plan.isPurchasable) {
    return { error: 'That plan is not on sale.' };
  }

  /*
   * The period decides which Whop plan is bought. They are separate objects
   * with separate prices, so the wrong one would charge a yearly buyer monthly.
   */
  const yearly = period === 'yearly' && plan.yearlyEnabled;
  const returnUrl = absoluteAppUrl('/settings/billing?status=success');

  try {
    const session = await createCheckoutSession({
      apiKey: config.apiKey,
      workspaceId: workspace.workspaceId,
      returnUrl,
      planKey: plan.key,
      whopPlanId: (yearly ? plan.whopPlanIdYearly : plan.whopPlanId) ?? undefined,
      companyId: config.companyId,
      plan: {
        key: yearly ? `${plan.key}-yearly` : plan.key,
        title: yearly ? `${plan.name} (yearly)` : plan.name,
        description: plan.description,
        priceUsd: Number(yearly ? plan.priceYearlyUsd : plan.priceMonthlyUsd),
        billingPeriodDays: yearly ? 365 : plan.billingPeriodDays,
        currency: plan.currency,
      },
    });

    return {
      sessionId: session.id,
      whopPlanId: session.whopPlanId ?? (yearly ? plan.whopPlanIdYearly : plan.whopPlanId) ?? '',
      returnUrl,
    };
  } catch (error) {
    logger.error('Could not start checkout', { error, planKey, period });
    return {
      error: isRekluError(error)
        ? error.userMessage
        : 'Could not start checkout. Please try again.',
    };
  }
}
