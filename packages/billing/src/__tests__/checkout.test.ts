/**
 * Minting a Whop checkout session.
 *
 * The thing worth pinning down is the metadata. The embedded checkout cannot
 * carry Reklu's workspace id by itself, so if `metadata.workspace_id` ever
 * stops being sent, every payment still succeeds — and every one of them
 * arrives at the webhook with no workspace to attach it to. Customers get
 * charged and stay on the free plan, with nothing in the logs saying why.
 *
 * So: assert the request body, and assert that a bad response is refused
 * rather than passed on as a session id the embed would silently ignore.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRekluError } from '@reklu/shared';
import { createCheckoutSession } from '../checkout';

/**
 * The operator-facing text lives on `userMessage`; `message` is the internal
 * one that carries status codes. Asserting the wrong one passes for the wrong
 * reason, so this reads the field a person actually sees.
 */
async function userMessageFrom(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (isRekluError(error)) return error.userMessage;
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the call to fail, but it resolved.');
}

const params = {
  apiKey: 'whop_test_key',
  whopPlanId: 'plan_abc123',
  planKey: 'pro',
  workspaceId: 'wsp_01hxyz',
  returnUrl: 'https://reklu.app/settings/billing',
};

/** A plan Reklu owns, for the path where Whop has not seen it yet. */
const definition = {
  key: 'pro',
  title: 'Pro',
  description: 'More AI units and priority models.',
  priceUsd: 25,
  billingPeriodDays: 30,
  currency: 'usd',
};

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

/** The single fetch call the module made, decoded. */
function sentRequest(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
  const init = call[1] as RequestInit;
  return {
    url: call[0] as string,
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCheckoutSession', () => {
  it('returns the session id Whop issued', async () => {
    respondWith({ id: 'ch_live_123' });
    await expect(createCheckoutSession(params)).resolves.toEqual({ id: 'ch_live_123' });
  });

  it('carries the workspace id and plan key in metadata', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession(params);

    expect(sentRequest().body).toMatchObject({
      mode: 'payment',
      plan_id: 'plan_abc123',
      metadata: { workspace_id: 'wsp_01hxyz', plan_key: 'pro' },
      redirect_url: params.returnUrl,
    });
  });

  /**
   * The path taken before a plan has ever been synced: Reklu describes the
   * plan instead of naming one, so a brand-new plan is buyable immediately
   * rather than after a separate setup step in Whop's dashboard.
   */
  it('sends the full plan definition when there is no Whop plan yet', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession({
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
      returnUrl: params.returnUrl,
      planKey: 'pro',
      plan: definition,
      companyId: 'biz_123',
    });

    expect(sentRequest().body).toMatchObject({
      mode: 'payment',
      plan: {
        company_id: 'biz_123',
        title: 'Pro',
        currency: 'usd',
        plan_type: 'renewal',
        initial_price: 0,
        renewal_price: 25,
        billing_period: 30,
      },
      metadata: { workspace_id: 'wsp_01hxyz', plan_key: 'pro' },
    });
  });

  /**
   * Whop adds `initial_price` to the first `renewal_price` on a renewal plan,
   * so setting both to the plan price charged everyone twice — a $25 plan
   * asked for $50 at checkout. The first payment must equal what the billing
   * page advertised, and this asserts the arithmetic rather than the fields.
   */
  it('charges the advertised price once, not twice', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession({
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
      returnUrl: params.returnUrl,
      planKey: 'pro',
      plan: definition,
      companyId: 'biz_123',
    });

    const plan = sentRequest().body.plan as {
      initial_price: number;
      renewal_price: number;
    };
    const firstCharge = plan.initial_price + plan.renewal_price;

    expect(firstCharge).toBe(definition.priceUsd);
    expect(plan.renewal_price).toBe(definition.priceUsd);
  });

  /**
   * A plan in Whop must belong to a product. Omitting this was the whole of
   * the "check the plan is published and payable" failure — every checkout was
   * refused before a card was ever shown.
   */
  it('gives the plan a product to belong to', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession({
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
      returnUrl: params.returnUrl,
      planKey: 'pro',
      plan: definition,
      companyId: 'biz_123',
    });

    const plan = sentRequest().body.plan as Record<string, unknown>;
    expect(plan.product).toMatchObject({
      external_identifier: 'reklu-pro',
      title: 'Reklu Pro',
    });
  });

  /**
   * The external identifier is derived from Reklu's plan key, so syncing the
   * same plan twice updates one product rather than leaving duplicates behind.
   */
  it('keeps the product identifier stable across syncs', async () => {
    respondWith({ id: 'ch_1' });
    await createCheckoutSession({
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
      returnUrl: params.returnUrl,
      planKey: 'pro',
      plan: { ...definition, priceUsd: 25 },
      companyId: 'biz_123',
    });
    const first = (sentRequest().body.plan as Record<string, unknown>)
      .product as Record<string, unknown>;

    respondWith({ id: 'ch_2' });
    await createCheckoutSession({
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
      returnUrl: params.returnUrl,
      planKey: 'pro',
      // A price change must not become a second product.
      plan: { ...definition, priceUsd: 30 },
      companyId: 'biz_123',
    });
    const second = (sentRequest().body.plan as Record<string, unknown>)
      .product as Record<string, unknown>;

    expect(second.external_identifier).toBe(first.external_identifier);
  });

  it("repeats Whop's own reason when it rejects the definition", async () => {
    respondWith({ message: 'product is required' }, 422);
    const message = await userMessageFrom(() => createCheckoutSession(params));
    expect(message).toMatch(/product is required/);
  });

  it('does not echo the body of an auth failure', async () => {
    respondWith({ message: 'token abc123 is invalid' }, 401);
    const message = await userMessageFrom(() => createCheckoutSession(params));
    expect(message).not.toMatch(/abc123/);
    expect(message).toMatch(/API key/i);
  });

  it('prefers an existing Whop plan over re-describing it', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession({ ...params, plan: definition, companyId: 'biz_123' });

    const body = sentRequest().body;
    expect(body.plan_id).toBe('plan_abc123');
    expect(body.plan).toBeUndefined();
  });

  it('refuses to ask Whop to charge for a plan it was never given', async () => {
    respondWith({ id: 'ch_live_123' });
    await expect(
      createCheckoutSession({
        apiKey: params.apiKey,
        workspaceId: params.workspaceId,
        returnUrl: params.returnUrl,
        planKey: 'pro',
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads back the plan id when Whop names one', async () => {
    respondWith({ id: 'ch_live_123', plan: { id: 'plan_new999' } });
    await expect(createCheckoutSession(params)).resolves.toEqual({
      id: 'ch_live_123',
      whopPlanId: 'plan_new999',
    });
  });

  it('tolerates a response that names no plan', async () => {
    respondWith({ id: 'ch_live_123' });
    const session = await createCheckoutSession(params);
    expect(session.whopPlanId).toBeUndefined();
  });

  it('posts to the checkout configurations endpoint with bearer auth', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession(params);

    const { url, init } = sentRequest();
    expect(url).toBe('https://api.whop.com/api/v1/checkout_configurations');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer whop_test_key');
  });

  it('never puts the api key anywhere but the header', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession(params);

    const { url, init } = sentRequest();
    expect(url).not.toContain('whop_test_key');
    expect(init.body as string).not.toContain('whop_test_key');
  });

  /**
   * Each status maps to something an operator can act on. "Checkout is
   * unavailable" would leave six possible causes and no way to tell them
   * apart — in the one part of the product where being vague costs money.
   */
  it.each([
    [401, /API key/i],
    [403, /API key/i],
    [404, /WHOP_PLAN_ID/i],
    [422, /rejected the plan definition/i],
    [429, /rate limit/i],
    [500, /their end/i],
  ])('explains a %i by name', async (status, expected) => {
    respondWith({ error: 'nope' }, status);
    expect(await userMessageFrom(() => createCheckoutSession(params))).toMatch(expected);
  });

  it('refuses a 200 that carries no id', async () => {
    respondWith({ ok: true });
    expect(await userMessageFrom(() => createCheckoutSession(params))).toMatch(/unusable/i);
  });

  it('refuses a 200 whose id is empty', async () => {
    respondWith({ id: '' });
    expect(await userMessageFrom(() => createCheckoutSession(params))).toMatch(/unusable/i);
  });

  it('refuses a 200 that is not JSON', async () => {
    respondWith('<html>maintenance</html>');
    expect(await userMessageFrom(() => createCheckoutSession(params))).toMatch(/unusable/i);
  });

  it('reports a network failure rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    expect(await userMessageFrom(() => createCheckoutSession(params))).toMatch(/reach Whop/i);
  });
});
