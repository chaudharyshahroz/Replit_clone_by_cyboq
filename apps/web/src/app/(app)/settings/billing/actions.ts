'use server';

import {
  billingConfig,
  createCheckoutSession,
  reconcileWorkspaceBilling,
  rememberCheckoutSession,
} from '@reklu/billing';
import { db, plans } from '@reklu/database';
import { eq } from 'drizzle-orm';
import { absoluteAppUrl, isRekluError, logger } from '@reklu/shared';
import { revalidatePath } from 'next/cache';
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

    /*
     * Recorded before the form opens, not after the payment.
     *
     * Whop stamps this session's id onto the membership it creates, so this row
     * is what lets Reklu find the purchase later by asking. Written first
     * because after the customer has paid is too late to start keeping track.
     */
    await rememberCheckoutSession({
      sessionId: session.id,
      workspaceId: workspace.workspaceId,
      planKey: plan.key,
      period: yearly ? 'yearly' : 'monthly',
      whopPlanId: session.whopPlanId ?? undefined,
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

/**
 * Check with Whop whether this workspace's plan should have changed.
 *
 * Offered as a button as well as run on return from checkout, because the one
 * thing someone who has paid and not been upgraded wants is a way to make the
 * app look again — rather than being told to wait, which is what Reklu used to
 * say and could not back up.
 */
export async function reconcileBillingAction(): Promise<{
  readonly message: string;
  readonly applied: boolean;
}> {
  const { workspace } = await getAppContext();
  const result = await reconcileWorkspaceBilling(workspace.workspaceId);

  switch (result.outcome) {
    case 'applied':
      revalidatePath('/settings/billing');
      revalidatePath('/settings/usage');
      return { message: 'Your plan is up to date.', applied: true };
    case 'nothing_pending':
      return { message: 'No recent purchase is waiting to be applied.', applied: false };
    case 'no_membership_yet':
      return {
        message:
          result.detail ??
          'Whop has no completed purchase for this workspace yet. If you have just paid, try again in a moment.',
        applied: false,
      };
    case 'unknown_plan':
      return {
        message:
          'Your purchase was found, but it does not match a plan Reklu currently sells. Please contact support.',
        applied: false,
      };
    case 'not_configured':
      return { message: result.detail ?? 'Payments are not configured.', applied: false };
    case 'lookup_failed':
      /*
       * Said as a failure to ask, not as an absence of a purchase. Telling
       * someone who has just paid that Whop has no record of it — when the
       * truth is that Reklu could not reach Whop — sends them to argue with
       * their bank about a charge that is perfectly valid.
       */
      return {
        message:
          result.detail ??
          'Could not reach Whop to check. Your payment is safe; this is a problem on Reklu’s side.',
        applied: false,
      };
  }
}
