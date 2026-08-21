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

/**
 * One authenticated GET.
 *
 * Failures are reported as `undefined`, never thrown. Every caller is on a path
 * where Whop being unreachable must not break the page — a customer looking at
 * their billing page should see their plan, not an error, when the thing that
 * is down is the service that already took their money.
 */
async function get(apiKey: string, path: string, query: Record<string, string>): Promise<Json | undefined> {
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
      return undefined;
    }

    return (await response.json().catch(() => undefined)) as Json | undefined;
  } catch (error) {
    logger.warn('Could not read from Whop', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
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
}): Promise<readonly WhopMembership[]> {
  const payload = await get(params.apiKey, '/memberships', {
    company_id: params.companyId,
    first: String(params.limit ?? 50),
    order: 'created_at',
    direction: 'desc',
  });

  return rows(payload)
    .map(toMembership)
    .filter((row): row is WhopMembership => row !== undefined);
}

/** Recent payments for a company, newest first. */
export async function listPayments(params: {
  readonly apiKey: string;
  readonly companyId: string;
  readonly limit?: number;
}): Promise<readonly WhopPayment[]> {
  const payload = await get(params.apiKey, '/payments', {
    company_id: params.companyId,
    first: String(params.limit ?? 50),
    order: 'created_at',
    direction: 'desc',
  });

  return rows(payload)
    .map(toPayment)
    .filter((row): row is WhopPayment => row !== undefined);
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
