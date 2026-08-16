/**
 * Agent runs, steps, and approval gates (spec §61–63).
 *
 * An agent is an execution engine with durable state, not one enormous prompt.
 * Persisting plan, steps, and outputs is what makes a run resumable, auditable,
 * cancellable, and boundable — and what lets a risky step stop and wait for a
 * human instead of proceeding.
 */
import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import { agentRunStatusEnum, agentStepStatusEnum, approvalStatusEnum } from './enums';
import { users } from './identity';
import { projects } from './projects';
import { workspaces } from './tenancy';

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: primaryId('agentRun'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),

    /** The user's stated goal, verbatim. */
    objective: text('objective').notNull(),
    status: agentRunStatusEnum('status').notNull().default('planning'),

    /** Structured plan produced before execution begins. */
    plan: jsonb('plan').$type<Record<string, unknown>>(),
    currentStepIndex: integer('current_step_index').notNull().default(0),
    totalSteps: integer('total_steps').notNull().default(0),

    /**
     * Hard ceilings. Spec §109: one broken loop must not be able to spend
     * without bound. Enforced by the engine on every step.
     */
    maxSteps: integer('max_steps').notNull().default(40),
    maxCostUsd: text('max_cost_usd').notNull().default('5.00'),
    stepsExecuted: integer('steps_executed').notNull().default(0),

    result: jsonb('result').$type<Record<string, unknown>>(),
    /** Artifacts the run produced. */
    artifactIds: jsonb('artifact_ids').$type<string[]>().notNull().default([]),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    jobId: text('job_id'),

    startedAt: tsColumn('started_at'),
    completedAt: tsColumn('completed_at'),
    cancelledAt: tsColumn('cancelled_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('agent_runs_workspace_idx').on(table.workspaceId),
    index('agent_runs_user_idx').on(table.userId),
    index('agent_runs_status_idx').on(table.status),
  ],
);

export const agentSteps = pgTable(
  'agent_steps',
  {
    id: primaryId('agentStep'),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    stepIndex: integer('step_index').notNull(),
    /** Short label rendered in the activity panel, e.g. "Research competitors". */
    title: text('title').notNull(),
    description: text('description'),
    status: agentStepStatusEnum('status').notNull().default('pending'),

    /** What this step does: 'tool' | 'model' | 'research' | 'build' | 'artifact'. */
    kind: text('kind').notNull(),
    toolName: text('tool_name'),
    modelKey: text('model_key'),

    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<unknown>(),

    attempts: integer('attempts').notNull().default(0),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),

    startedAt: tsColumn('started_at'),
    completedAt: tsColumn('completed_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('agent_steps_run_index_idx').on(table.agentRunId, table.stepIndex),
    index('agent_steps_run_idx').on(table.agentRunId),
    index('agent_steps_status_idx').on(table.status),
  ],
);

/**
 * A blocking human decision. The run does not proceed past a step requiring
 * approval until a person resolves this row (spec §63).
 */
export const agentApprovals = pgTable(
  'agent_approvals',
  {
    id: primaryId('agentApproval'),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    agentStepId: text('agent_step_id').references(() => agentSteps.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Plain-language description of the action awaiting consent. */
    action: text('action').notNull(),
    /** Why it needs approval, e.g. "sends email on your behalf". */
    reason: text('reason').notNull(),
    riskClass: text('risk_class').notNull(),
    /** Exact payload that will be executed if approved — no bait and switch. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),

    status: approvalStatusEnum('status').notNull().default('pending'),
    decidedBy: text('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tsColumn('decided_at'),
    denialReason: text('denial_reason'),
    /** Unresolved approvals expire rather than blocking a run forever. */
    expiresAt: tsColumn('expires_at'),
    ...timestamps,
  },
  (table) => [
    index('agent_approvals_run_idx').on(table.agentRunId),
    index('agent_approvals_status_idx').on(table.status),
    index('agent_approvals_workspace_idx').on(table.workspaceId),
  ],
);

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [agentRuns.workspaceId], references: [workspaces.id] }),
  project: one(projects, { fields: [agentRuns.projectId], references: [projects.id] }),
  steps: many(agentSteps),
  approvals: many(agentApprovals),
}));

export const agentStepsRelations = relations(agentSteps, ({ one }) => ({
  run: one(agentRuns, { fields: [agentSteps.agentRunId], references: [agentRuns.id] }),
}));

export const agentApprovalsRelations = relations(agentApprovals, ({ one }) => ({
  run: one(agentRuns, { fields: [agentApprovals.agentRunId], references: [agentRuns.id] }),
  step: one(agentSteps, { fields: [agentApprovals.agentStepId], references: [agentSteps.id] }),
}));

export type AgentRun = typeof agentRuns.$inferSelect;
export type AgentStep = typeof agentSteps.$inferSelect;
export type AgentApproval = typeof agentApprovals.$inferSelect;
