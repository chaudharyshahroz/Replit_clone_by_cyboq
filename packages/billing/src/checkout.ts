/**
 * Creating a Whop checkout session (spec §72).
 *
 * This exists because the embedded checkout cannot carry Reklu's workspace id
 * on its own. The `data-whop-checkout-session` attribute takes a session id
 * that Whop issues — `ch_…` — and metadata can only be attached when that
 * session is created through the API. Putting a raw workspace id in that
 * attribute, which is what Reklu did first, attaches nothing: the payment
 * succeeds, the webhook arrives with no workspace to match, and the customer
 * is charged without being upgraded.
 *
 * So the id is minted server-side, with the workspace in metadata, and the
 * webhook reads it back out.
 *
 * See: https://docs.whop.com/api-reference/checkout-configurations/create-checkout-configuration
 */
import { errors, logger } from '@reklu/shared';
import { WHOP_API_BASE } from './config';

/** Whop can be slow under load; a hung request must not hang the page. */
const TIMEOUT_MS = 15_000;

export interface CheckoutSession {
  /** The `ch_…` id for `data-whop-checkout-session`. */
  readonly id: string;
  /** The Whop plan the session resolved to, when the response names one. */
  readonly whopPlanId?: string | undefined;
}

/**
 * A plan as Reklu defines it. Whop is told about it; it is not asked.
 *
 * Prices live in Reklu's `plans` table so an administrator changes them in one
 * place. Sending the definition rather than a pre-made Whop plan id is what
 * removes the failure where the two drift and the page advertises one number
 * while the card is charged another.
 */
export interface PlanDefinition {
  readonly key: string;
  readonly title: string;
  readonly description?: string | null;
  readonly priceUsd: number;
  readonly billingPeriodDays: number;
  readonly currency: string;
}

/**
 * Whop's response nests the plan differently depending on the call, and the
 * shape is not guaranteed. Read it defensively: a missing id is recoverable
 * (the next checkout sends the definition again), a wrong one is not.
 */
function planIdFrom(payload: Record<string, unknown>): string | undefined {
  const direct = payload.plan_id;
  if (typeof direct === 'string' && direct.startsWith('plan_')) return direct;

  const plan = payload.plan as Record<string, unknown> | undefined;
  if (plan && typeof plan.id === 'string' && plan.id.startsWith('plan_')) return plan.id;

  return undefined;
}

/** Pull a human-readable reason out of an error body, whatever shape it took. */
function readReason(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) return value.slice(0, 300);
    }
    // Field-level validation usually arrives keyed by field name.
    const errors = parsed.errors;
    if (errors && typeof errors === 'object') return JSON.stringify(errors).slice(0, 300);
  } catch {
    // Not JSON — a proxy error page, most likely. The status alone is the signal.
    return undefined;
  }
  return undefined;
}

/**
 * Turn a failed call into something an operator can act on.
 *
 * "Checkout is unavailable" tells nobody which of six things to fix, and
 * billing is the worst place to be vague.
 */
function describeFailure(status: number, reason?: string): string {
  const suffix = reason ? ` Whop said: ${reason}` : '';
  if (status === 401 || status === 403) {
    return 'Whop rejected the API key. Check WHOP_API_KEY is correct and has checkout permissions.';
  }
  if (status === 404) {
    return 'Whop does not recognise that plan. Check WHOP_PLAN_ID_PRO and WHOP_PLAN_ID_TEAM match plans in your Whop company.';
  }
  if (status === 422 || status === 400) {
    // Echoed, because these are field-level validation problems and the
    // generic version sent people looking in the wrong place for a whole day.
    return `Whop rejected the plan definition.${suffix}`;
  }
  if (status === 429) return 'Whop is rate limiting checkout requests. Try again shortly.';
  if (status >= 500) return 'Whop is having trouble on their end. Try again shortly.';
  return `Whop returned an unexpected status ${status}.`;
}

/**
 * Mint a checkout session for one workspace and plan.
 *
 * `metadata.workspace_id` is the whole point: it is the only link between a
 * payment and a Reklu workspace that does not depend on matching email
 * addresses, which would attach a stranger's payment to the wrong account.
 */
export async function createCheckoutSession(params: {
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly returnUrl: string;
  /** Reklu's plan key, carried so the webhook need not match on plan id. */
  readonly planKey: string;
  /** An existing Whop plan, when this plan has already been synced. */
  readonly whopPlanId?: string | undefined;
  /** The definition to create from, when it has not. Needs a company. */
  readonly plan?: PlanDefinition | undefined;
  readonly companyId?: string | undefined;
}): Promise<CheckoutSession> {
  /**
   * One of the two has to be usable, or Whop is being asked to charge for
   * something nobody has described.
   */
  if (!params.whopPlanId && !(params.plan && params.companyId)) {
    throw errors.notConfigured({
      feature: 'Checkout',
      requiredEnv: ['WHOP_COMPANY_ID'],
      docsPath: '/admin/billing',
    });
  }

  const planPart = params.whopPlanId
    ? { plan_id: params.whopPlanId }
    : {
        plan: {
          company_id: params.companyId,
          title: params.plan!.title,
          ...(params.plan!.description ? { description: params.plan!.description } : {}),
          currency: params.plan!.currency,
          plan_type: 'renewal',
          /**
           * Zero, deliberately.
           *
           * On a renewal plan Whop charges `initial_price` *on top of* the
           * first `renewal_price` — it is a setup fee, not the first period.
           * Setting both to the plan price billed everyone double at checkout:
           * a $25 plan asked for $50. Reklu sells a flat monthly price with no
           * joining fee, so the only correct value here is nothing.
           */
          initial_price: 0,
          renewal_price: params.plan!.priceUsd,
          billing_period: params.plan!.billingPeriodDays,
          visibility: 'hidden',
          /**
           * A plan in Whop has to belong to a product, and the first version of
           * this sent neither `product` nor `product_id` — so Whop refused every
           * request with "check the plan is published and payable", which was
           * true but pointed at the wrong thing.
           *
           * `external_identifier` is what makes repeated syncs idempotent: it is
           * Reklu's own plan key, so editing a price updates the same product
           * instead of leaving a trail of duplicates in the dashboard.
           */
          product: {
            external_identifier: `reklu-${params.plan!.key}`,
            title: `Reklu ${params.plan!.title}`,
            ...(params.plan!.description ? { description: params.plan!.description } : {}),
          },
        },
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${WHOP_API_BASE}/checkout_configurations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'payment',
        ...planPart,
        /*
         * Both, deliberately. The workspace says whose plan to change; the
         * plan key says which plan, without the webhook having to recognise a
         * Whop plan id it may be seeing for the first time.
         */
        metadata: { workspace_id: params.workspaceId, plan_key: params.planKey },
        redirect_url: params.returnUrl,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    logger.error('Whop checkout session request failed', { error });
    if (aborted) throw errors.upstreamTimeout('Whop', TIMEOUT_MS);
    throw errors.providerError({
      provider: 'Whop',
      detail: error instanceof Error ? error.message : String(error),
      userMessage: 'Could not reach Whop to start checkout. Try again shortly.',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The body may carry a reason, and may equally carry nothing useful.
    const body = await response.text().catch(() => '');
    logger.error('Whop refused a checkout session', {
      status: response.status,
      body: body.slice(0, 500),
    });

    /*
     * Only for the statuses where the reason is a field problem. An auth
     * failure's body is not echoed — nothing useful is in it, and it is the one
     * place an upstream message could carry something about the credential.
     */
    const reason =
      response.status === 400 || response.status === 422
        ? readReason(body)
        : undefined;
    const detail = describeFailure(response.status, reason);
    throw errors.providerError({
      provider: 'Whop',
      detail: `checkout_configurations returned ${response.status}`,
      userMessage: detail,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  const payload = (await response.json().catch(() => undefined)) as
    | { id?: unknown }
    | undefined;

  /**
   * Checked rather than assumed: without a usable id the embed would mount
   * with an empty session and silently lose the metadata again — the exact
   * failure this module exists to prevent.
   */
  if (!payload || typeof payload.id !== 'string' || payload.id.length === 0) {
    logger.error('Whop returned a checkout session with no id', { payload });
    throw errors.providerError({
      provider: 'Whop',
      detail: 'checkout_configurations returned no id',
      userMessage: 'Whop returned an unusable checkout session.',
      retryable: true,
    });
  }

  return { id: payload.id, whopPlanId: planIdFrom(payload as Record<string, unknown>) };
}

/**
 * Make a plan exist in Whop, from Reklu's definition of it.
 *
 * Implemented through the checkout endpoint's inline plan rather than the
 * plans API, which is in beta and gated behind a dated version header. This
 * path is documented and stable, and it is the same call checkout makes — so
 * a plan that syncs here is one that can definitely be bought.
 *
 * The checkout configuration it creates as a side effect is harmless and
 * unused; the plan it materialises is the point.
 */
export async function syncPlanToWhop(params: {
  readonly apiKey: string;
  readonly companyId: string;
  readonly plan: PlanDefinition;
  readonly returnUrl: string;
}): Promise<{ readonly whopPlanId: string | undefined }> {
  const session = await createCheckoutSession({
    apiKey: params.apiKey,
    companyId: params.companyId,
    plan: params.plan,
    planKey: params.plan.key,
    // No real workspace is buying anything here; this exists to create the
    // plan. A placeholder that cannot match a workspace is safer than a real
    // id, which a stray webhook could act on.
    workspaceId: 'wsp_sync_probe',
    returnUrl: params.returnUrl,
  });

  return { whopPlanId: session.whopPlanId };
}
