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
import { grantsAccess, listMemberships, listPayments } from '../whop-api';

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

    const [membership] = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });

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
    await expect(listMemberships({ apiKey: 'k', companyId: 'biz_1' })).resolves.toEqual([]);
  });

  it('returns nothing rather than throwing when the request fails outright', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(listMemberships({ apiKey: 'k', companyId: 'biz_1' })).resolves.toEqual([]);
  });

  it('skips a row with no id rather than inventing one', async () => {
    respond({ data: [{ status: 'active' }, MEMBERSHIP] });
    const found = await listMemberships({ apiKey: 'k', companyId: 'biz_1' });
    expect(found).toHaveLength(1);
  });

  it('survives a response with no data array', async () => {
    respond({});
    await expect(listMemberships({ apiKey: 'k', companyId: 'biz_1' })).resolves.toEqual([]);
  });
});

describe('listPayments', () => {
  it('reads the card the customer would recognise', async () => {
    respond({ data: [PAYMENT] });

    const [payment] = await listPayments({ apiKey: 'k', companyId: 'biz_1' });

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

    const [payment] = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
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
    const [payment] = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
    expect(payment?.amount).toBe('40.00');
  });

  it('leaves the card undefined when Whop sent none', async () => {
    respond({ data: [{ id: 'pay_1', payment_instrument: { display_name: 'Cash App Pay' } }] });
    const [payment] = await listPayments({ apiKey: 'k', companyId: 'biz_1' });
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
