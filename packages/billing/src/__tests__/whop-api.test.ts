/**
 * Reading from Whop.
 *
 * These tests exist because this module's whole job is knowing Whop's field
 * names, and a wrong one fails silently: `card_last4` read as `last_4` yields
 * undefined, which looks exactly like a customer who paid by wallet. Every
 * field asserted here was taken from Whop's API reference, so if they rename
 * one, this is where it shows up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_SCOPES,
  cancelMembership,
  grantsAccess,
  listMemberships,
  listPayments,
  resumeMembership,
} from '../whop-api';

const originalFetch = globalThis.fetch;

/** One membership, in the shape Whop's reference documents. */
const MEMBERSHIP = {
  id: 'mem_abc123',
  status: 'active',
  checkout_configuration_id: 'ch_session1',
  plan: { id: 'plan_xyz', metadata: {} },
  renewal_period_end: '2026-09-16T05:00:00.401Z',
  cancel_at_period_end: false,
  manage_url: 'https://whop.com/billing/manage/mem_abc123',
  metadata: { workspace_id: 'wsp_1' },
};

const PAYMENT = {
  id: 'pay_abc123',
  final_amount: 25,
  currency: 'usd',
  paid_at: '2026-08-21T05:00:00.401Z',
  card_brand: 'mastercard',
  card_last4: '4242',
  checkout_configuration_id: 'ch_session1',
  membership: { id: 'mem_abc123', status: 'active' },
  payment_instrument: { card: { brand: 'mastercard', last4: '4242' }, display_name: 'Mastercard' },
};

let calls: string[] = [];

function respond(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('listMemberships', () => {
  it('reads the fields reconciliation depends on', async () => {
    respond({ data: [MEMBERSHIP] });

    const { memberships } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    const membership = memberships[0];

    expect(membership?.id).toBe('mem_abc123');
    expect(membership?.checkoutConfigurationId).toBe('ch_session1');
    expect(membership?.planId).toBe('plan_xyz');
    expect(membership?.status).toBe('active');
    expect(membership?.manageUrl).toBe('https://whop.com/billing/manage/mem_abc123');
    expect(membership?.renewalPeriodEnd?.toISOString()).toBe('2026-09-16T05:00:00.401Z');
    expect(membership?.cancelAtPeriodEnd).toBe(false);
  });

  /* Required by Whop when authenticating with an API key. */
  it('scopes the request to the company', async () => {
    respond({ data: [] });
    await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(calls[0]).toContain('company_id=biz_1');
  });

  it('asks for the newest first, because only recent purchases can be pending', async () => {
    respond({ data: [] });
    await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(calls[0]).toContain('order=created_at');
    expect(calls[0]).toContain('direction=desc');
  });

  /*
   * Whop being unreachable must not throw: every caller is on a page a paying
   * customer is looking at, and an error there is worse than a stale plan.
   */
  it('returns nothing rather than throwing when Whop refuses', async () => {
    respond({ error: 'nope' }, 401);
    const { memberships } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toEqual([]);
  });

  it('returns nothing rather than throwing when the request fails outright', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { memberships } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toEqual([]);
  });

  it('skips a row with no id rather than inventing one', async () => {
    respond({ data: [{ status: 'active' }, MEMBERSHIP] });
    const { memberships } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toHaveLength(1);
  });

  it('survives a response with no data array', async () => {
    respond({});
    const { memberships } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toEqual([]);
  });
});

describe('listPayments', () => {
  it('reads the card the customer would recognise', async () => {
    respond({ data: [PAYMENT] });

    const { payments } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    const payment = payments[0];

    expect(payment?.cardBrand).toBe('mastercard');
    expect(payment?.cardLast4).toBe('4242');
    expect(payment?.membershipId).toBe('mem_abc123');
    expect(payment?.amount).toBe('25');
    expect(payment?.currency).toBe('usd');
  });

  /* Whop sends the card two ways; either alone has to be enough. */
  it('falls back to the payment instrument for the card', async () => {
    respond({
      data: [
        {
          id: 'pay_1',
          payment_instrument: { card: { brand: 'visa', last4: '1111' } },
        },
      ],
    });

    const { payments } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    const payment = payments[0];
    expect(payment?.cardBrand).toBe('visa');
    expect(payment?.cardLast4).toBe('1111');
  });

  /*
   * A payment filed at zero because the amount field moved would appear in a
   * customer's history as free. Unknown is recorded as '0' but the payment is
   * still filed, because the fact of it is what the history is for.
   */
  it('finds the amount under any of the names Whop has used', async () => {
    respond({ data: [{ id: 'pay_1', amount: '40.00' }] });
    const { payments } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    const payment = payments[0];
    expect(payment?.amount).toBe('40.00');
  });

  it('leaves the card undefined when Whop sent none', async () => {
    respond({ data: [{ id: 'pay_1', payment_instrument: { display_name: 'Cash App Pay' } }] });
    const { payments } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    const payment = payments[0];
    expect(payment?.cardBrand).toBeUndefined();
    expect(payment?.cardLast4).toBeUndefined();
    expect(payment?.methodLabel).toBe('Cash App Pay');
  });
});

describe('grantsAccess', () => {
  it.each(['active', 'trialing', 'completed'])('grants access on %s', (status) => {
    expect(grantsAccess(status)).toBe(true);
  });

  it.each(['canceled', 'expired', 'past_due', 'unresolved', 'drafted'])(
    'does not grant access on %s',
    (status) => {
      expect(grantsAccess(status)).toBe(false);
    },
  );

  /*
   * `completed` is a paid-in-full one-off, not a lapse. Treating it as expired
   * would take away something that was paid for.
   */
  it('treats a completed one-off purchase as paid, not lapsed', () => {
    expect(grantsAccess('completed')).toBe(true);
  });
});

/**
 * A refusal is not an absence.
 *
 * These two were collapsed into one answer — both returned an empty list — and
 * the billing page rendered the result as "Whop has no completed purchase for
 * this workspace", shown to a customer who had paid minutes earlier and could
 * see the charge in Whop. Reklu had not asked and failed to find the payment.
 * Reklu had failed to ask.
 */
describe('reporting why a read failed', () => {
  it('reports nothing wrong when Whop genuinely has no memberships', async () => {
    respond({ data: [] });
    const { memberships, failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toEqual([]);
    expect(failure).toBeUndefined();
  });

  /*
   * The cause of this bug, found after four rounds: a company API key is
   * created with none of these scopes, so a company with real paying customers
   * reads back as having none at all.
   */
  it('names every scope the endpoint needs on 403', async () => {
    respond(
      { error: { type: 'forbidden', message: 'Company API key is not authorized for the member:basic:read scope.' } },
      403,
    );

    const { failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });

    expect(failure?.status).toBe(403);
    for (const scope of REQUIRED_SCOPES['/memberships']!) {
      expect(failure?.detail).toContain(scope);
    }
    expect(failure?.detail).toContain('API keys');
  });

  /*
   * All of them, not just the one Whop named. Whop reports only the first scope
   * it hit, so granting that alone produces the same error on the next one —
   * a round trip per scope, through a live payment each time.
   */
  it('names more than the single scope Whop reported', async () => {
    respond({ error: 'not authorized for the member:basic:read scope' }, 403);
    const { failure } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    expect(failure?.detail).toContain('payment:basic:read');
    expect(failure?.detail).toContain('plan:basic:read');
  });

  it('names the API key on 401', async () => {
    respond({ error: 'unauthorized' }, 401);
    const { failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(failure?.detail).toContain('WHOP_API_KEY');
  });

  it('names the company on 404', async () => {
    respond({ error: 'not found' }, 404);
    const { failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(failure?.detail).toContain('WHOP_COMPANY_ID');
  });

  it('reports a network failure rather than an empty result', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const { memberships, failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(memberships).toEqual([]);
    expect(failure).toBeDefined();
    expect(failure?.detail).toContain('Could not reach Whop');
  });

  it('reports a refusal when reading payments too', async () => {
    respond({ error: 'forbidden' }, 403);
    const { failure } = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    expect(failure?.status).toBe(403);
  });

  /*
   * Whop's own words are carried through. A message naming the exact field or
   * scope they objected to is worth more than any wording invented here.
   */
  it('carries Whop’s own explanation through', async () => {
    respond({ error: 'missing scope: memberships:read' }, 403);
    const { failure } = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(failure?.detail).toContain('memberships:read');
  });
});

/**
 * Cancelling.
 *
 * The failure rule here is the opposite of a read's. A read that fails can
 * degrade to showing less; a write that fails must never be reported as having
 * worked — telling someone their subscription is cancelled when Whop refused
 * would have them stop expecting a charge that is still coming.
 */
describe('cancelling a membership', () => {
  const cancelled = {
    id: 'mem_abc123',
    status: 'active',
    cancel_at_period_end: true,
    renewal_period_end: '2026-09-21T05:00:00.401Z',
    plan: { id: 'plan_xyz' },
    metadata: {},
  };

  it('asks Whop to end it at the period end, not immediately', async () => {
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (input: unknown, init: unknown) => {
      calls.push(String(input));
      bodies.push(String((init as { body?: unknown }).body ?? ''));
      return new Response(JSON.stringify(cancelled), { status: 200 });
    }) as unknown as typeof fetch;

    await cancelMembership({ apiKey: 'k', membershipId: 'mem_abc123' });

    expect(calls[0]).toContain('/memberships/mem_abc123/cancel');
    expect(bodies[0]).toContain('at_period_end');
    expect(bodies[0]).not.toContain('immediate');
  });

  it('reports what Whop confirmed', async () => {
    respond(cancelled);
    const { membership, failure } = await cancelMembership({ apiKey: 'k', membershipId: 'mem_abc123' });

    expect(failure).toBeUndefined();
    expect(membership?.cancelAtPeriodEnd).toBe(true);
    expect(membership?.renewalPeriodEnd?.toISOString()).toBe('2026-09-21T05:00:00.401Z');
  });

  /* The one that matters: a refusal must not read as a cancellation. */
  it('reports a refusal rather than an empty success', async () => {
    respond({ error: 'forbidden' }, 403);
    const { membership, failure } = await cancelMembership({ apiKey: 'k', membershipId: 'mem_1' });

    expect(membership).toBeUndefined();
    expect(failure?.status).toBe(403);
    expect(failure?.detail).toContain('membership:cancel');
  });

  it('says nothing was changed when Whop cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const { failure } = await cancelMembership({ apiKey: 'k', membershipId: 'mem_1' });
    expect(failure?.detail).toContain('Nothing was changed');
  });

  /* An id in the path is user-adjacent data and is escaped, not interpolated raw. */
  it('escapes the membership id in the path', async () => {
    respond(cancelled);
    await cancelMembership({ apiKey: 'k', membershipId: 'mem/../evil' });
    expect(calls[0]).not.toContain('mem/../evil');
    expect(calls[0]).toContain('mem%2F..%2Fevil');
  });
});

describe('resuming a membership', () => {
  it('asks Whop to uncancel', async () => {
    respond({ id: 'mem_1', status: 'active', cancel_at_period_end: false, metadata: {} });
    const { membership } = await resumeMembership({ apiKey: 'k', membershipId: 'mem_1' });

    expect(calls[0]).toContain('/memberships/mem_1/uncancel');
    expect(membership?.cancelAtPeriodEnd).toBe(false);
  });

  it('names the scope it needs on a refusal', async () => {
    respond({ error: 'forbidden' }, 403);
    const { failure } = await resumeMembership({ apiKey: 'k', membershipId: 'mem_1' });
    expect(failure?.detail).toContain('member:manage');
  });
});
