/**
 * Read models for the Agents UI.
 *
 * Separate from the runner so screens depend on display shapes rather than on
 * tables, and so nothing here can accidentally advance a run.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { agentApprovals, agentRuns, agentSteps, db } from '@reklu/database';

export interface RunSummary {
  readonly id: string;
  readonly objective: string;
  readonly status: string;
  readonly stepsExecuted: number;
  readonly totalSteps: number;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
}

export async function listRuns(workspaceId: string, limit = 30): Promise<RunSummary[]> {
  return db
    .select({
      id: agentRuns.id,
      objective: agentRuns.objective,
      status: agentRuns.status,
      stepsExecuted: agentRuns.stepsExecuted,
      totalSteps: agentRuns.totalSteps,
      errorMessage: agentRuns.errorMessage,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.workspaceId, workspaceId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
}

export interface StepView {
  readonly id: string;
  readonly stepIndex: number;
  readonly title: string;
  readonly description: string | null;
  readonly kind: string;
  readonly toolName: string | null;
  readonly status: string;
  readonly output: unknown;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
}

export interface PendingApproval {
  readonly id: string;
  readonly action: string;
  readonly reason: string;
  readonly riskClass: string;
  readonly payload: unknown;
  readonly expiresAt: Date | null;
}

export interface RunDetail extends RunSummary {
  readonly maxSteps: number;
  readonly maxCostUsd: string;
  readonly steps: readonly StepView[];
  readonly pendingApproval: PendingApproval | undefined;
}

export async function getRun(
  runId: string,
  workspaceId: string,
): Promise<RunDetail | undefined> {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)))
    .limit(1);

  if (!run) return undefined;

  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.agentRunId, runId))
    .orderBy(asc(agentSteps.stepIndex));

  const [pending] = await db
    .select()
    .from(agentApprovals)
    .where(
      and(eq(agentApprovals.agentRunId, runId), eq(agentApprovals.status, 'pending')),
    )
    .limit(1);

  return {
    id: run.id,
    objective: run.objective,
    status: run.status,
    stepsExecuted: run.stepsExecuted,
    totalSteps: run.totalSteps,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    maxSteps: run.maxSteps,
    maxCostUsd: run.maxCostUsd,
    steps: steps.map((step) => ({
      id: step.id,
      stepIndex: step.stepIndex,
      title: step.title,
      description: step.description,
      kind: step.kind,
      toolName: step.toolName,
      status: step.status,
      output: step.output,
      errorMessage: step.errorMessage,
      durationMs: step.durationMs,
    })),
    pendingApproval: pending
      ? {
          id: pending.id,
          action: pending.action,
          reason: pending.reason,
          riskClass: pending.riskClass,
          // Shown verbatim: the person approves this exact payload, and the
          // runner refuses to execute anything that differs from it.
          payload: pending.payload,
          expiresAt: pending.expiresAt,
        }
      : undefined,
  };
}
