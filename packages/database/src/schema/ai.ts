/**
 * AI providers, the model registry, and per-request accounting.
 *
 * Spec §10 and §80: models are *data*, not code. An administrator enables a
 * model, changes its plan availability, adjusts its routing priority, or puts a
 * provider into maintenance without a deploy. Reklu Auto reads its routing
 * inputs from these rows, so improving routing is a configuration change.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, tsColumn } from './_shared';
import {
  aiProviderKindEnum,
  modelCostTierEnum,
  modelSpeedEnum,
  usageKindEnum,
} from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

export const aiProviders = pgTable(
  'ai_providers',
  {
    id: primaryId('aiProvider'),
    kind: aiProviderKindEnum('kind').notNull(),
    /** Stable machine key used by the adapter registry, e.g. "anthropic". */
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),

    enabled: boolean('enabled').notNull().default(true),
    /** Admin kill switch that survives a restart; shown to users as unavailable. */
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),
    maintenanceMessage: text('maintenance_message'),

    /**
     * Which env var supplies this provider's key. The value is never stored in
     * the database — only the name of the variable to read.
     */
    apiKeyEnvVar: text('api_key_env_var').notNull(),
    baseUrlOverride: text('base_url_override'),

    /** Observed health, updated by the provider circuit breaker. */
    lastHealthyAt: tsColumn('last_healthy_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('ai_providers_key_idx').on(table.key)],
);

export const aiModels = pgTable(
  'ai_models',
  {
    id: primaryId('aiModel'),
    providerId: text('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'cascade' }),

    /** Provider-side identifier actually sent on the wire. */
    modelIdentifier: text('model_identifier').notNull(),
    /** Stable internal key referenced by projects and conversations. */
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),

    // ---- Capabilities. Reklu Auto routes on these. ------------------------
    contextWindow: integer('context_window').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsTools: boolean('supports_tools').notNull().default(false),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    supportsReasoning: boolean('supports_reasoning').notNull().default(false),
    supportsStructuredOutput: boolean('supports_structured_output').notNull().default(false),
    supportsFiles: boolean('supports_files').notNull().default(false),
    supportsEmbeddings: boolean('supports_embeddings').notNull().default(false),

    speed: modelSpeedEnum('speed').notNull().default('balanced'),
    costTier: modelCostTierEnum('cost_tier').notNull().default('standard'),

    /**
     * Internal cost in USD per million tokens. `numeric` rather than float:
     * these values are multiplied out into billing, where binary rounding drift
     * is unacceptable.
     */
    inputCostPerMillion: numeric('input_cost_per_million', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    outputCostPerMillion: numeric('output_cost_per_million', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),

    /** Free-text hints Reklu Auto scores against, e.g. ["coding","long-context"]. */
    bestFor: jsonb('best_for').$type<string[]>().notNull().default([]),
    /** Higher wins when several models satisfy the same requirement. */
    routingPriority: integer('routing_priority').notNull().default(0),

    enabled: boolean('enabled').notNull().default(true),
    /** Plan keys allowed to select this model; empty means every plan. */
    availableOnPlans: jsonb('available_on_plans').$type<string[]>().notNull().default([]),
    /** Hidden from the picker but still reachable by Reklu Auto / internal use. */
    internalOnly: boolean('internal_only').notNull().default(false),

    /** Ordering within its provider group in the model selector. */
    sortOrder: integer('sort_order').notNull().default(0),
    deprecatedAt: tsColumn('deprecated_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('ai_models_key_idx').on(table.key),
    index('ai_models_provider_idx').on(table.providerId),
    index('ai_models_enabled_idx').on(table.enabled),
    index('ai_models_routing_idx').on(table.enabled, table.routingPriority),
  ],
);

/**
 * One row per provider call. This is the observability and cost-attribution
 * spine: every token Reklu spends is traceable to a user, a workspace, a
 * project, and the feature that caused it.
 */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: primaryId('aiRequest'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id'),
    conversationId: text('conversation_id'),
    messageId: text('message_id'),

    modelId: text('model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    /** Denormalized so historical rows survive a model being deleted. */
    modelKey: text('model_key').notNull(),
    providerKey: text('provider_key').notNull(),

    kind: usageKindEnum('kind').notNull(),

    /** True when Reklu Auto chose the model, with the reason it chose it. */
    autoRouted: boolean('auto_routed').notNull().default(false),
    routingReason: text('routing_reason'),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),

    /** Computed from the model's rates at request time, not at read time. */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),

    latencyMs: integer('latency_ms'),
    timeToFirstTokenMs: integer('time_to_first_token_ms'),

    status: text('status').notNull().default('succeeded'), // succeeded | failed | cancelled
    errorCode: text('error_code'),
    /** Set when a fallback provider served the request after a primary failure. */
    fellBackFrom: text('fell_back_from'),

    /** Correlates with structured logs and the job that triggered this. */
    requestId: text('request_id'),
    jobId: text('job_id'),
    ...timestamps,
  },
  (table) => [
    index('ai_requests_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('ai_requests_user_idx').on(table.userId),
    index('ai_requests_project_idx').on(table.projectId),
    index('ai_requests_model_idx').on(table.modelKey),
    index('ai_requests_conversation_idx').on(table.conversationId),
  ],
);

export const aiProvidersRelations = relations(aiProviders, ({ many }) => ({
  models: many(aiModels),
}));

export const aiModelsRelations = relations(aiModels, ({ one }) => ({
  provider: one(aiProviders, { fields: [aiModels.providerId], references: [aiProviders.id] }),
}));

export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
export type AiRequest = typeof aiRequests.$inferSelect;
export type NewAiRequest = typeof aiRequests.$inferInsert;
