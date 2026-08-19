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
}

/**
 * Turn a failed call into something an operator can act on.
 *
 * "Checkout is unavailable" tells nobody which of six things to fix, and
 * billing is the worst place to be vague.
 */
function describeFailure(status: number): string {
  if (status === 401 || status === 403) {
    return 'Whop rejected the API key. Check WHOP_API_KEY is correct and has checkout permissions.';
  }
  if (status === 404) {
    return 'Whop does not recognise that plan. Check WHOP_PLAN_ID_PRO and WHOP_PLAN_ID_TEAM match plans in your Whop company.';
  }
  if (status === 422 || status === 400) {
    return 'Whop refused the checkout request. Check the plan is published and payable.';
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
  readonly whopPlanId: string;
  readonly workspaceId: string;
  readonly returnUrl: string;
}): Promise<CheckoutSession> {
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
        plan_id: params.whopPlanId,
        metadata: { workspace_id: params.workspaceId },
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
    const detail = describeFailure(response.status);
    // The body may carry a reason, and may equally carry nothing useful.
    const body = await response.text().catch(() => '');
    logger.error('Whop refused a checkout session', {
      status: response.status,
      body: body.slice(0, 500),
    });
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

  return { id: payload.id };
}
