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
  workspaceId: 'wsp_01hxyz',
  returnUrl: 'https://reklu.app/settings/billing',
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

  it('carries the workspace id in metadata', async () => {
    respondWith({ id: 'ch_live_123' });
    await createCheckoutSession(params);

    expect(sentRequest().body).toMatchObject({
      mode: 'payment',
      plan_id: 'plan_abc123',
      metadata: { workspace_id: 'wsp_01hxyz' },
      redirect_url: params.returnUrl,
    });
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
    [422, /published|payable/i],
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
