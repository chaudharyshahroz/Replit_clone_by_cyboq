/**
 * A record of what Whop has actually sent.
 *
 * The same failure — paid customer, plan unchanged — was diagnosed from guesses
 * twice, because two very different causes look identical from outside: the
 * delivery never arrived, or it arrived and named no workspace. One is fixed in
 * Whop's dashboard, the other in this code. Nothing on Reklu's side could tell
 * them apart, so this writes down every delivery as it happens.
 *
 * Key names are recorded, values are not. The question has always been "what
 * shape did Whop send?", which key names answer without putting a customer's
 * email or payment details into a debugging table.
 */
import { desc } from 'drizzle-orm';
import { db, webhookDeliveries } from '@reklu/database';
import { logger } from '@reklu/shared';

export type DeliveryOutcome =
  /** Signature did not verify — the request was refused. */
  | 'rejected'
  /** Verified but the body could not be parsed. */
  | 'unreadable'
  /** Verified, parsed, and of a type Reklu does not act on. */
  | 'unhandled'
  /** Acted on: a plan changed. */
  | 'applied'
  /** Understood but deliberately not acted on — unknown workspace or plan. */
  | 'ignored'
  /** Reklu threw. Whop will retry. */
  | 'failed';

export interface DeliveryRecord {
  readonly externalId: string | null;
  readonly eventType: string | null;
  readonly outcome: DeliveryOutcome;
  readonly detail?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly payload?: Record<string, unknown> | undefined;
}

/**
 * File one delivery.
 *
 * Never throws. This is a diagnostic record: failing the webhook because the
 * record could not be written would turn an observability aid into an outage,
 * and Whop would retry a delivery that had already been applied.
 */
export async function recordDelivery(record: DeliveryRecord): Promise<void> {
  try {
    const payload = record.payload ?? {};
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;

    await db
      .insert(webhookDeliveries)
      .values({
        externalId: record.externalId,
        provider: 'whop',
        eventType: record.eventType,
        outcome: record.outcome,
        detail: record.detail ?? null,
        workspaceId: record.workspaceId ?? null,
        payloadKeys: Object.keys(payload),
        metadataKeys: Object.keys(metadata),
      })
      .onConflictDoUpdate({
        target: webhookDeliveries.externalId,
        set: {
          outcome: record.outcome,
          detail: record.detail ?? null,
          workspaceId: record.workspaceId ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logger.warn('Could not record a webhook delivery', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface DeliverySummary {
  readonly id: string;
  readonly externalId: string | null;
  readonly eventType: string | null;
  readonly outcome: string;
  readonly detail: string | null;
  readonly workspaceId: string | null;
  readonly payloadKeys: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly receivedAt: Date;
}

/** The most recent deliveries, newest first. */
export async function recentDeliveries(limit = 25): Promise<readonly DeliverySummary[]> {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    eventType: row.eventType,
    outcome: row.outcome,
    detail: row.detail,
    workspaceId: row.workspaceId,
    payloadKeys: row.payloadKeys,
    metadataKeys: row.metadataKeys,
    receivedAt: row.createdAt,
  }));
}
