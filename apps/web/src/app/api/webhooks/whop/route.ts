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
import {
  applyMembershipEvent,
  billingConfig,
  isHandledEvent,
  parseEvent,
  recordDelivery,
  verifyWebhook,
} from '@reklu/billing';
import { loadServerEnv, logger } from '@reklu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const config = billingConfig();
  /*
   * Whop's own delivery id, used to file this attempt. Every branch below
   * records what happened — including the ones that refuse the request —
   * because "no delivery arrived" and "a delivery arrived and was rejected"
   * are the two answers this endpoint exists to tell apart, and until now it
   * could report neither.
   */
  const deliveryId = request.headers.get('webhook-id');

  if (!config.canVerifyWebhooks) {
    // Accepting deliveries that cannot be verified would be worse than
    // refusing them: an unverified membership event is an unauthenticated
    // instruction to change someone's plan.
    logger.error('Whop delivery arrived but WHOP_WEBHOOK_SECRET is not set');
    await recordDelivery({
      externalId: deliveryId,
      eventType: null,
      outcome: 'rejected',
      detail: 'WHOP_WEBHOOK_SECRET is not set, so nothing could be verified.',
    });
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
    await recordDelivery({
      externalId: deliveryId,
      eventType: null,
      outcome: 'rejected',
      detail: `${result.failure}: ${result.reason}`,
    });
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    // Verified but unreadable. Answering 400 rather than 500 stops Whop
    // retrying something that will never parse.
    await recordDelivery({
      externalId: deliveryId,
      eventType: null,
      outcome: 'unreadable',
      detail: 'The signature verified but the body did not parse.',
    });
    return NextResponse.json({ error: 'Unreadable event payload.' }, { status: 400 });
  }

  if (!isHandledEvent(event.type)) {
    // Acknowledged so Whop stops retrying, and explicitly not acted on.
    await recordDelivery({
      externalId: deliveryId,
      eventType: event.type,
      outcome: 'unhandled',
      detail: 'Reklu does not act on this event type.',
      payload: event.data,
    });
    return NextResponse.json({ ok: true, handled: false, type: event.type });
  }

  try {
    const applied = await applyMembershipEvent({ type: event.type, data: event.data });

    logger.info('Applied a Whop event', {
      type: event.type,
      outcome: applied.outcome,
      workspaceId: applied.workspaceId,
    });

    await recordDelivery({
      externalId: deliveryId,
      eventType: event.type,
      outcome: applied.outcome.startsWith('ignored') ? 'ignored' : 'applied',
      detail: applied.detail ?? applied.outcome,
      workspaceId: applied.workspaceId,
      payload: event.data,
    });

    // 200 even when ignored: an event Reklu will never understand should not
    // be retried forever.
    return NextResponse.json({ ok: true, outcome: applied.outcome });
  } catch (error) {
    // A genuine failure — a database outage — SHOULD be retried, so this is
    // the one path that answers 500.
    logger.error('Failed to apply a Whop event', { error, type: event.type });
    await recordDelivery({
      externalId: deliveryId,
      eventType: event.type,
      outcome: 'failed',
      detail: error instanceof Error ? error.message : String(error),
      payload: event.data,
    });
    return NextResponse.json({ error: 'Could not apply the event.' }, { status: 500 });
  }
}
