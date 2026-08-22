/**
 * Reading from Whop.
 *
 * Reklu is told about payments by webhook, but being told is not something it
 * can rely on: a delivery can be misconfigured, dropped, or arrive with the
 * metadata Reklu needs missing. This module is the other direction — asking
 * Whop what actually happened — so a customer who has paid can be given what
 * they paid for without waiting to be notified.
 *
 * Contracts verified against Whop's API reference rather than remembered:
 *   GET /api/v1/memberships  — carries `checkout_configuration_id`, `status`,
 *                              `plan.id`, `renewal_period_end`, `manage_url`
 *   GET /api/v1/payments     — carries `card_brand`, `card_last4`,
 *                              `payment_instrument`, `membership.id`
 */
import { logger } from '@reklu/shared';
import { WHOP_API_BASE } from './config';

const TIMEOUT_MS = 10_000;

/** The fields of a Whop membership that Reklu acts on. */
export interface WhopMembership {
  readonly id: string;
  readonly status: string;
  readonly checkoutConfigurationId: string | undefined;
  readonly planId: string | undefined;
  readonly renewalPeriodEnd: Date | undefined;
  readonly cancelAtPeriodEnd: boolean;
  readonly manageUrl: string | undefined;
  readonly metadata: Record<string, unknown>;
}

/** The fields of a Whop payment that Reklu shows or files. */
export interface WhopPayment {
  readonly id: string;
  readonly membershipId: string | undefined;
  readonly checkoutConfigurationId: string | undefined;
  readonly amount: string;
  readonly currency: string;
  readonly paidAt: Date | undefined;
  readonly cardBrand: string | undefined;
  readonly cardLast4: string | undefined;
  readonly methodLabel: string | undefined;
}

type Json = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const date = (value: unknown): Date | undefined => {
  const text = str(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Why a read failed, in words that name the thing to fix. */
export interface WhopFailure {
  readonly status: number | undefined;
  readonly detail: string;
}

interface ReadResult {
  readonly payload?: Json | undefined;
  readonly failure?: WhopFailure | undefined;
}

/**
 * One authenticated GET.
 *
 * Never throws — every caller is on a path where Whop being unreachable must
 * not break the page. But a failure is *reported*, not swallowed: the first
 * version returned `undefined` for both "Whop said no" and "Whop said nothing
 * matched", and the billing page turned that into "Whop has no completed
 * purchase for this workspace" — telling a customer who had just paid that
 * their payment did not exist, when the truth was that Reklu could not ask.
 */
async function get(apiKey: string, path: string, query: Record<string, string>): Promise<ReadResult> {
  const url = new URL(`${WHOP_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn('Whop refused a read', { path, status: response.status, body: body.slice(0, 300) });
      return {
        failure: {
          status: response.status,
          detail: describeReadFailure(path, response.status, body),
        },
      };
    }

    return { payload: (await response.json().catch(() => undefined)) as Json | undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Could not read from Whop', { path, error: message });
    return {
      failure: {
        status: undefined,
        detail:
          error instanceof Error && error.name === 'AbortError'
            ? `Whop did not answer ${path} within ${TIMEOUT_MS / 1000} seconds.`
            : `Could not reach Whop to read ${path}: ${message}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The permissions Whop requires for each endpoint Reklu reads.
 *
 * Taken from the "Required permissions" line on each endpoint's page in Whop's
 * API reference, not guessed. A company API key is created with none of these
 * by default, which is why a perfectly valid key on a company with real paying
 * customers reads back as though the company has none.
 */
export const REQUIRED_SCOPES: Readonly<Record<string, readonly string[]>> = {
  '/memberships': ['member:basic:read', 'member:email:read'],
  '/memberships/{id}/cancel': ['membership:cancel', 'member:basic:read', 'member:email:read'],
  '/memberships/{id}/uncancel': ['member:manage', 'member:basic:read', 'member:email:read'],
  '/payments': [
    'payment:basic:read',
    'plan:basic:read',
    'access_pass:basic:read',
    'member:basic:read',
    'member:email:read',
    'member:phone:read',
    'promo_code:basic:read',
    'shipment:basic:read',
  ],
  '/checkout_configurations': [
    'checkout_configuration:create',
    'checkout_configuration:basic:read',
    'plan:create',
    'access_pass:create',
    'access_pass:update',
  ],
};

/**
 * What a refusal means, said as the thing to change.
 *
 * "403" on its own sends someone to read logs. "Your API key cannot read
 * memberships" sends them to the one screen in Whop where that is fixed — and
 * a missing permission on the key is the most likely reason a company with real
 * paying customers reads back as having none.
 */
function describeReadFailure(path: string, status: number, body: string): string {
  const snippet = body.slice(0, 200).trim();
  const suffix = snippet ? ` Whop said: ${snippet}` : '';

  if (status === 401) {
    return `Whop rejected the API key when reading ${path}. Check WHOP_API_KEY.${suffix}`;
  }
  if (status === 403) {
    /*
     * The scopes are named because Whop's own message names only the first one
     * missing — granting that alone produces the same error again on the next
     * scope, one round trip at a time.
     */
    const scopes = REQUIRED_SCOPES[path];
    const needed = scopes
      ? ` This endpoint needs: ${scopes.join(', ')}. Add them all in Whop under Developer → API keys → your key → Permissions.`
      : '';
    return `The API key is not authorized to read ${path}.${needed}${suffix}`;
  }
  if (status === 404) {
    return `Whop has no ${path} for this company. Check WHOP_COMPANY_ID is the company the plans were bought from.${suffix}`;
  }
  if (status === 429) return `Whop is rate limiting reads of ${path}. Try again shortly.`;
  if (status >= 500) return `Whop is having trouble on their end (${status}).`;
  return `Whop returned ${status} reading ${path}.${suffix}`;
}

/** The `data` array of a Whop list response. */
function rows(payload: Json | undefined): Json[] {
  const data = payload?.data;
  return Array.isArray(data) ? (data.filter((row) => row && typeof row === 'object') as Json[]) : [];
}

function toMembership(row: Json): WhopMembership | undefined {
  const id = str(row.id);
  if (!id) return undefined;

  const plan = (row.plan ?? {}) as Json;
  return {
    id,
    status: str(row.status) ?? 'unknown',
    checkoutConfigurationId: str(row.checkout_configuration_id),
    planId: str(plan.id) ?? str(row.plan_id),
    renewalPeriodEnd: date(row.renewal_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    manageUrl: str(row.manage_url),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function toPayment(row: Json): WhopPayment | undefined {
  const id = str(row.id);
  if (!id) return undefined;

  const membership = (row.membership ?? {}) as Json;
  const instrument = (row.payment_instrument ?? {}) as Json;
  const card = (instrument.card ?? {}) as Json;

  /*
   * Several names for the amount, because Whop has used several over time. A
   * payment filed at zero because the field moved would show in a customer's
   * history as a free transaction, which is worse than showing it as unknown.
   */
  const amount = [row.final_amount, row.amount, row.subtotal, row.total].find(
    (value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''),
  );

  return {
    id,
    membershipId: str(membership.id),
    checkoutConfigurationId: str(row.checkout_configuration_id),
    amount: amount === undefined ? '0' : String(amount),
    currency: str(row.currency) ?? 'usd',
    paidAt: date(row.paid_at) ?? date(row.created_at),
    cardBrand: str(row.card_brand) ?? str(card.brand),
    cardLast4: str(row.card_last4) ?? str(card.last4),
    methodLabel: str(instrument.display_name),
  };
}

/**
 * Recent memberships for a company.
 *
 * There is no filter for `checkout_configuration_id`, so the match is made by
 * the caller against the sessions Reklu minted. Ordered newest first and
 * bounded, because the only memberships that can be waiting to be reconciled
 * are recent ones.
 */
export async function listMemberships(params: {
  readonly apiKey: string;
  readonly companyId: string;
  readonly limit?: number;
}): Promise<{
  readonly memberships: readonly WhopMembership[];
  readonly failure: WhopFailure | undefined;
}> {
  const result = await get(params.apiKey, '/memberships', {
    company_id: params.companyId,
    first: String(params.limit ?? 50),
    order: 'created_at',
    direction: 'desc',
  });

  return {
    memberships: rows(result.payload)
      .map(toMembership)
      .filter((row): row is WhopMembership => row !== undefined),
    failure: result.failure,
  };
}

/** Recent payments for a company, newest first. */
export async function listPayments(params: {
  readonly apiKey: string;
  readonly companyId: string;
  readonly limit?: number;
}): Promise<{
  readonly payments: readonly WhopPayment[];
  readonly failure: WhopFailure | undefined;
}> {
  const result = await get(params.apiKey, '/payments', {
    company_id: params.companyId,
    first: String(params.limit ?? 50),
    order: 'created_at',
    direction: 'desc',
  });

  return {
    payments: rows(result.payload)
      .map(toPayment)
      .filter((row): row is WhopPayment => row !== undefined),
    failure: result.failure,
  };
}

/**
 * Whether a Whop membership status means the customer currently has access.
 *
 * `completed` is deliberately included: a one-off purchase that has been paid
 * in full reads as completed, not active, and treating it as lapsed would take
 * away something that was paid for.
 */
export function grantsAccess(status: string): boolean {
  return status === 'active' || status === 'trialing' || status === 'completed';
}

/**
 * One authenticated POST.
 *
 * Separate from `get` because the failure rule is the opposite: a read that
 * fails can degrade to showing less, but a write that fails must never be
 * reported as having worked. Cancelling is the case that matters — telling
 * someone their subscription is cancelled when Whop refused the request would
 * have them stop expecting a charge that is still coming.
 */
async function post(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<ReadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${WHOP_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.error('Whop refused a write', { path, status: response.status, body: text.slice(0, 300) });
      return {
        failure: { status: response.status, detail: describeWriteFailure(path, response.status, text) },
      };
    }

    return { payload: (await response.json().catch(() => ({}))) as Json };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Could not write to Whop', { path, error: message });
    return {
      failure: {
        status: undefined,
        detail: `Could not reach Whop. Nothing was changed — your subscription is unchanged. (${message})`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A refusal on a write, said as the thing to change. */
function describeWriteFailure(path: string, status: number, body: string): string {
  /* The concrete path carries an id; the scope table is keyed by the template. */
  const template = path.replace(/\/memberships\/[^/]+\//, '/memberships/{id}/');
  const scopes = REQUIRED_SCOPES[template];
  const snippet = body.slice(0, 200).trim();

  if (status === 403 && scopes) {
    return `The API key is not authorized for this. It needs: ${scopes.join(', ')}. Add them in Whop under Developer → API keys → your key → Permissions.${
      snippet ? ` Whop said: ${snippet}` : ''
    }`;
  }
  if (status === 404) return 'Whop no longer has this subscription. Nothing was changed.';
  if (status === 401) return 'Whop rejected the API key. Check WHOP_API_KEY.';
  if (status >= 500) return `Whop is having trouble on their end (${status}). Nothing was changed.`;
  return `Whop returned ${status}. Nothing was changed.${snippet ? ` ${snippet}` : ''}`;
}

/**
 * Stop a membership renewing.
 *
 * At the end of the paid period, never immediately. The customer has paid for
 * the period they are in and cancelling should not take it away from them —
 * an immediate cancellation would forfeit time they already bought, and turn
 * a routine action into a refund conversation.
 */
export async function cancelMembership(params: {
  readonly apiKey: string;
  readonly membershipId: string;
}): Promise<{ readonly membership: WhopMembership | undefined; readonly failure: WhopFailure | undefined }> {
  const result = await post(
    params.apiKey,
    `/memberships/${encodeURIComponent(params.membershipId)}/cancel`,
    { cancellation_mode: 'at_period_end' },
  );

  return {
    membership: result.payload ? toMembership(result.payload) : undefined,
    failure: result.failure,
  };
}

/** Undo a scheduled cancellation, while the period is still running. */
export async function resumeMembership(params: {
  readonly apiKey: string;
  readonly membershipId: string;
}): Promise<{ readonly membership: WhopMembership | undefined; readonly failure: WhopFailure | undefined }> {
  const result = await post(
    params.apiKey,
    `/memberships/${encodeURIComponent(params.membershipId)}/uncancel`,
    {},
  );

  return {
    membership: result.payload ? toMembership(result.payload) : undefined,
    failure: result.failure,
  };
}
