/**
 * Plans, subscriptions, and the usage ledger (spec §73–76).
 *
 * Two rules shape this schema:
 *
 *  1. Pricing is data. Limits live in `plans.limits`, so changing what Pro
 *     includes is a configuration change, not a deploy (spec §73).
 *  2. Subscription state is only ever written from verified Stripe webhooks.
 *     Nothing the browser sends can grant entitlement.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { subscriptionStatusEnum, usageKindEnum } from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

/** Per-plan quotas and gates. Shape is validated by a Zod schema in the billing package. */
export interface PlanLimits {
  /** Billable AI units per period; null means unmetered. */
  readonly aiUnitsPerMonth: number | null;
  readonly deepResearchPerMonth: number | null;
  readonly buildProjectsMax: number | null;
  readonly imageGenerationsPerMonth: number | null;
  readonly videoGenerationsPerMonth: number | null;
  readonly fileUploadMaxMb: number;
  readonly storageMaxGb: number;
  readonly workspaceMembersMax: number | null;
  readonly mcpServersMax: number | null;
  readonly concurrentJobsMax: number;
  /** Empty means every enabled model is available. */
  readonly allowedModelKeys: readonly string[];
  readonly features: readonly string[];
}

export const plans = pgTable(
  'plans',
  {
    id: primaryId('plan'),
    /** Stable key referenced by models and feature checks: free | pro | team. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    priceMonthlyUsd: numeric('price_monthly_usd', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    priceYearlyUsd: numeric('price_yearly_usd', { precision: 10, scale: 2 }).notNull().default('0'),

    /**
     * Vestigial. Reklu bills through Whop; these predate that decision and are
     * kept only because dropping a column is destructive and nothing reads
     * them. Remove them in a migration of their own.
     */
    stripeProductId: text('stripe_product_id'),
    stripePriceIdMonthly: text('stripe_price_id_monthly'),
    stripePriceIdYearly: text('stripe_price_id_yearly'),

    /**
     * The Whop side of a plan.
     *
     * Reklu owns the definition — an administrator edits the price here, not in
     * Whop's dashboard — and Whop holds a matching plan object to charge
     * against. `whopPlanId` is that object once it exists.
     *
     * The sync result is stored rather than inferred, so the admin list can say
     * "this plan is not in Whop yet, and here is why" instead of letting the
     * first paying customer discover it.
     */
    whopPlanId: text('whop_plan_id'),
    /**
     * The yearly plan is a separate object in Whop.
     *
     * A Whop plan carries one billing period and one price, so monthly and
     * yearly cannot be the same object. Reklu keeps one row per tier and two
     * ids, rather than two rows that would have to be kept in step by hand.
     */
    whopPlanIdYearly: text('whop_plan_id_yearly'),
    whopSyncedAt: tsColumn('whop_synced_at'),
    whopSyncError: text('whop_sync_error'),

    /** Charge interval in days. 30 is Whop's monthly. */
    billingPeriodDays: integer('billing_period_days').notNull().default(30),
    currency: text('currency').notNull().default('usd'),

    /**
     * Whether this plan can be bought. Separate from `isPublic`: a plan can be
     * visible to existing subscribers while no longer being sold.
     */
    isPurchasable: boolean('is_purchasable').notNull().default(false),

    limits: jsonb('limits').$type<PlanLimits>().notNull(),

    /** Hidden from pricing but still honoured for existing subscribers. */
    isPublic: boolean('is_public').notNull().default(true),
    /** Whether a yearly option is offered alongside the monthly one. */
    yearlyEnabled: boolean('yearly_enabled').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('plans_key_idx').on(table.key)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId('subscription'),
    /** Billing is per workspace, so a team pays once (spec §71). */
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),

    status: subscriptionStatusEnum('status').notNull().default('active'),

    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),

    /**
     * Whop's membership, and the page where the customer manages it.
     *
     * `setPlan` used to write this as `externalSubscriptionId`, which is not a
     * column. Drizzle silently drops an unknown key from `.set()` — it does not
     * throw — and a conditional spread hides the mistake from TypeScript, so
     * the id was quietly discarded on every event since the Whop migration.
     * Without it there was no way back from a Reklu workspace to the Whop
     * membership, which is exactly what reconciliation needs.
     */
    whopMembershipId: text('whop_membership_id'),
    /** Whop's own manage page for this membership, when they gave us one. */
    manageUrl: text('manage_url'),

    currentPeriodStart: tsColumn('current_period_start').notNull(),
    /** Usage quotas reset at this boundary. */
    currentPeriodEnd: tsColumn('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: tsColumn('canceled_at'),
    trialEndsAt: tsColumn('trial_ends_at'),

    /**
     * Guards against out-of-order webhook delivery: an event older than the one
     * already applied is ignored rather than resurrecting stale state.
     */
    lastWebhookEventId: text('last_webhook_event_id'),
    lastWebhookAt: tsColumn('last_webhook_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('subscriptions_workspace_idx').on(table.workspaceId),
    uniqueIndex('subscriptions_stripe_idx').on(table.stripeSubscriptionId),
    index('subscriptions_status_idx').on(table.status),
  ],
);

/**
 * Append-only usage ledger. Every metered operation writes one row, so a user's
 * bill and a workspace's quota can both be derived by summation and explained
 * line by line (spec §74–75).
 */
/**
 * Payments Whop has told us about.
 *
 * Recorded from the webhook rather than read back from Whop on every page
 * view: a customer's own billing history should not depend on a third party
 * being reachable, and the events arrive anyway.
 *
 * Amounts are stored as Whop reported them. Reklu does not compute what was
 * charged — it was charged elsewhere, and a locally derived figure that
 * disagreed with the card statement would be worse than no figure at all.
 */
export const payments = pgTable(
  'payments',
  {
    id: primaryId('payment'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planId: text('plan_id').references(() => plans.id, { onDelete: 'set null' }),

    amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('usd'),

    /** Whop's own id, so a retried delivery does not record a second payment. */
    externalPaymentId: text('external_payment_id'),
    status: text('status').notNull().default('succeeded'),

    /*
     * What the customer paid with, as Whop reported it.
     *
     * A brand and four digits are all Reklu ever learns and all it needs to
     * show — enough for someone to recognise which card was charged, and
     * nothing that could be used to charge it again. Null where Whop sent no
     * card details, which is the honest state for a wallet or a bank transfer;
     * `payment_instrument.display_name` covers those.
     */
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    paymentMethodLabel: text('payment_method_label'),

    ...timestamps,
  },
  (table) => [
    index('payments_workspace_idx').on(table.workspaceId, table.createdAt),
    uniqueIndex('payments_external_idx').on(table.externalPaymentId),
  ],
);

/**
 * Checkout sessions Reklu has minted, and who they were for.
 *
 * This is the durable link between a payment and a workspace, and it exists
 * because the previous one was not durable: the workspace id was put into Whop
 * checkout metadata and read back off the webhook, so if that metadata did not
 * survive the round trip — or the delivery never arrived — a customer was
 * charged and never upgraded, with nothing on Reklu's side to work back from.
 *
 * Whop stamps `checkout_configuration_id` onto the membership and the payment
 * it creates. Recording the session at the moment it is minted means the
 * workspace can always be recovered by asking Whop what happened, rather than
 * waiting to be told.
 */
export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    /** Whop's `ch_…` id. Theirs, so it is the primary key rather than a copy. */
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Reklu's plan key, not a Whop id: what the buyer chose. */
    planKey: text('plan_key').notNull(),
    /** 'monthly' | 'yearly' — which of the tier's two Whop plans was bought. */
    period: text('period').notNull().default('monthly'),
    whopPlanId: text('whop_plan_id'),
    /** Set once a membership has been matched to this session. */
    reconciledAt: tsColumn('reconciled_at'),
    /**
     * When Whop was last asked about this session.
     *
     * Reconciliation runs automatically on app page loads so a customer never
     * has to press anything, and this is what stops that becoming a Whop API
     * call on every navigation.
     */
    lastCheckedAt: tsColumn('last_checked_at'),
    ...timestamps,
  },
  (table) => [index('checkout_sessions_workspace_idx').on(table.workspaceId, table.createdAt)],
);

/**
 * Every webhook delivery Whop has made, and what Reklu did with it.
 *
 * This exists because the same bug was diagnosed twice from guesses. A customer
 * paid and stayed on Free, and there was no way to tell the two possible causes
 * apart: the delivery never arrived, or it arrived and named nobody. Those need
 * opposite fixes — one is a URL in Whop's dashboard, the other is a bug in this
 * code — and picking wrong costs another round trip through a real payment.
 *
 * Written for *every* delivery, including ones rejected for a bad signature and
 * ones deliberately ignored, because "nothing arrived" and "something arrived
 * and was refused" look identical from the outside and are the whole question.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: primaryId('webhookDelivery'),
    /** Whop's `webhook-id` header. Unique, so a retry updates rather than piles up. */
    externalId: text('external_id'),
    provider: text('provider').notNull().default('whop'),
    eventType: text('event_type'),

    /** verified | rejected | unhandled | applied | ignored | failed */
    outcome: text('outcome').notNull(),
    detail: text('detail'),

    workspaceId: text('workspace_id'),
    /**
     * The payload's top-level and metadata key names — not its values.
     *
     * The question every time has been "what did Whop actually send?", and the
     * answer was never in the logs. Key names answer it without storing a
     * customer's email or payment details in a table built for debugging.
     */
    payloadKeys: jsonb('payload_keys').$type<readonly string[]>().notNull().default([]),
    metadataKeys: jsonb('metadata_keys').$type<readonly string[]>().notNull().default([]),

    ...timestamps,
  },
  (table) => [
    index('webhook_deliveries_created_idx').on(table.createdAt),
    uniqueIndex('webhook_deliveries_external_idx').on(table.externalId),
  ],
);

export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: primaryId('usage'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id'),

    kind: usageKindEnum('kind').notNull(),
    /** Human-readable operation, e.g. "Deep Research" or "Presentation". */
    operation: text('operation').notNull(),

    providerKey: text('provider_key'),
    modelKey: text('model_key'),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Non-token quantities: images, seconds of video, sandbox minutes. */
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull().default('0'),

    /** What Reklu paid the provider. */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    /** What the customer is charged against their quota. */
    billableUnits: numeric('billable_units', { precision: 12, scale: 4 }).notNull().default('0'),

    /** The billing period this row counts against; indexed for fast quota sums. */
    periodStart: tsColumn('period_start').notNull(),

    aiRequestId: text('ai_request_id'),
    jobId: text('job_id'),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('usage_ledger_workspace_period_idx').on(table.workspaceId, table.periodStart),
    index('usage_ledger_kind_idx').on(table.workspaceId, table.kind, table.periodStart),
    index('usage_ledger_user_idx').on(table.userId),
    index('usage_ledger_created_idx').on(table.createdAt),
  ],
);

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  workspace: one(workspaces, { fields: [subscriptions.workspaceId], references: [workspaces.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageLedgerEntry = typeof usageLedger.$inferSelect;
export type NewUsageLedgerEntry = typeof usageLedger.$inferInsert;
