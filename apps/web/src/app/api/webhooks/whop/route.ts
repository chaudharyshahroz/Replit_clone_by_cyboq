/**
 * Whop webhook endpoint (spec §72–§75).
 *
 * The only unauthenticated write path in Reklu, and it changes what a customer
 * has paid for — so the signature is the authentication. Three things follow
 * from that and are visible in the order of this handler:
 *
 *   1. The **raw body** is read before anything parses it. `request.json()`
 *      would discard the exact bytes the signature covers.
 *   2. Verification happens before the payload is even looked at.
 *   3. Unverified requests are answered 401 and nothing else happens.
 */
import { NextResponse } from 'next/server';
import { applyMembershipEvent, billingConfig, isHandledEvent, parseEvent, verifyWebhook } from '@reklu/billing';
import { loadServerEnv, logger } from '@reklu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();

  if (!config.canVerifyWebhooks) {
    // Accepting deliveries that cannot be verified would be worse than
    // refusing them: an unverified membership event is an unauthenticated
    // instruction to change someone's plan.
    logger.error('Whop delivery arrived but WHOP_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Billing webhooks are not configured.' }, { status: 503 });
  }

  // Read the exact bytes that were signed, before any parsing.
  const rawBody = await request.text();

  const result = verifyWebhook({
    secret: loadServerEnv().WHOP_WEBHOOK_SECRET,
    headers: {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
    rawBody,
  });

  if (!result.valid) {
    // The reason is safe to log — it never contains the secret or signature.
    logger.warn('Rejected a Whop delivery', { failure: result.failure, reason: result.reason });
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    // Verified but unreadable. Answering 400 rather than 500 stops Whop
    // retrying something that will never parse.
    return NextResponse.json({ error: 'Unreadable event payload.' }, { status: 400 });
  }

  if (!isHandledEvent(event.type)) {
    // Acknowledged so Whop stops retrying, and explicitly not acted on.
    return NextResponse.json({ ok: true, handled: false, type: event.type });
  }

  try {
    const applied = await applyMembershipEvent({ type: event.type, data: event.data });

    logger.info('Applied a Whop event', {
      type: event.type,
      outcome: applied.outcome,
      workspaceId: applied.workspaceId,
    });

    // 200 even when ignored: an event Reklu will never understand should not
    // be retried forever.
    return NextResponse.json({ ok: true, outcome: applied.outcome });
  } catch (error) {
    // A genuine failure — a database outage — SHOULD be retried, so this is
    // the one path that answers 500.
    logger.error('Failed to apply a Whop event', { error, type: event.type });
    return NextResponse.json({ error: 'Could not apply the event.' }, { status: 500 });
  }
}
