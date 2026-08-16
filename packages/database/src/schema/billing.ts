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

    stripeProductId: text('stripe_product_id'),
    stripePriceIdMonthly: text('stripe_price_id_monthly'),
    stripePriceIdYearly: text('stripe_price_id_yearly'),

    limits: jsonb('limits').$type<PlanLimits>().notNull(),

    /** Hidden from pricing but still honoured for existing subscribers. */
    isPublic: boolean('is_public').notNull().default(true),
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
