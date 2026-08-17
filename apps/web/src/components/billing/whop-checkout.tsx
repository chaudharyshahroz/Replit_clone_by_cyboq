'use client';

import Script from 'next/script';

/**
 * Inlined rather than imported from @reklu/billing.
 *
 * That package reaches the database, and importing one constant from it drags
 * those modules into the browser bundle — the same mistake made twice before
 * with @reklu/skills and @reklu/mcp. `pnpm verify:repo` now checks for it.
 */
const WHOP_CHECKOUT_SCRIPT = 'https://js.whop.com/static/checkout/loader.js';

/**
 * Whop's embedded checkout.
 *
 * The payment form renders in an iframe Whop serves, which is the point: card
 * details are entered on their origin and never touch Reklu's. Reklu never
 * sees, stores or transmits a card number.
 *
 * `workspaceId` rides along as the checkout session so the webhook can attach
 * the resulting membership to the right workspace. Matching on email would be
 * wrong — someone may pay with a different address than they signed up with,
 * and a wrong guess upgrades a stranger.
 */
export function WhopCheckout({
  planId,
  workspaceId,
  returnUrl,
}: {
  readonly planId: string;
  readonly workspaceId: string;
  readonly returnUrl: string;
}) {
  return (
    <>
      <Script src={WHOP_CHECKOUT_SCRIPT} strategy="afterInteractive" />
      <div
        data-whop-checkout-plan-id={planId}
        data-whop-checkout-return-url={returnUrl}
        data-whop-checkout-session={workspaceId}
        data-whop-checkout-theme="dark"
        className="min-h-[32rem] w-full overflow-hidden rounded-xl border border-border"
      />
    </>
  );
}
