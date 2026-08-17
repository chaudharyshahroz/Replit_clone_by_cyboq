/**
 * The agent run loop (spec §62–§63, §109).
 *
 * A run is a durable row, not an in-memory loop. It plans, then executes one
 * step at a time, pausing whenever a step needs a human. That shape is forced
 * by the requirement rather than chosen for elegance: an approval can take a
 * day, and nothing in a web request survives that.
 *
 * So `advanceRun` executes **at most one step** and returns. The caller — a
 * worker, a poll, a click on Approve — drives it forward. A crash between
 * steps loses nothing, because the next call reads the row and continues.
 */
import { and, asc, eq } from 'drizzle-orm';
import { checkQuota, getProvider, loadRegistry, recordUsage, selectableModels } from '@reklu/ai';
import { agentApprovals, agentRuns, agentSteps, db } from '@reklu/database';
import { executeTool, usableTools, type RiskClass } from '@reklu/mcp';
import { enqueue } from '@reklu/queue';
import { errors, logger, newId } from '@reklu/shared';
import { APPROVAL_TTL_MS, checkApproval, describeAction, requiresApproval } from './approvals';
import { checkBudget, clampCost, clampSteps, parseBudget, USD } from './budget';
import { PLAN_PROMPT, parsePlan } from './plan';

export interface StartRunInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly objective: string;
  readonly projectId?: string | null;
  readonly maxSteps?: number | undefined;
  readonly maxCostMicroUsd?: number | undefined;
}

export interface RunProgress {
  readonly runId: string;
  readonly status: string;
  readonly stepsExecuted: number;
  readonly totalSteps: number;
  readonly detail: string;
  /** Set when the run is blocked on a person. */
  readonly awaitingApprovalId?: string | undefined;
}

/**
 * Refuse before spending, not after.
 *
 * Agents were shipped without this, and they are the worst place to omit it:
 * one run is a loop of model calls, so an exhausted workspace could spend its
 * way through an entire plan before anything noticed. Checked on every step,
 * not only at planning, because the quota can be consumed by something else
 * while a run is paused on an approval.
 */
async function assertWithinQuota(workspaceId: string): Promise<Date> {
  const quota = await checkQuota(workspaceId);

  if (quota?.exceeded) {
    throw errors.quotaExceeded({
      resource: 'AI units',
      used: Math.round(quota.used),
      limit: quota.limit ?? 0,
      resetsAt: quota.periodEnd,
    });
  }

  return quota?.periodStart ?? new Date();
}

async function pickModel() {
  const registry = await loadRegistry();
  const allowed = selectableModels(registry, undefined);
  if (allowed.length === 0) {
    throw errors.notConfigured({
      feature: 'Agents',
      requiredEnv: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
      docsPath: '/settings',
    });
  }
  return (
    allowed.find((model) => model.bestFor.includes('reasoning')) ?? allowed[0]!
  );
}

/**
 * Plan the work and record it.
 *
 * Planning happens once, before any step runs, so the person can see what is
 * about to happen. A run that planned nothing never reaches `running`.
 */
export async function startRun(input: StartRunInput): Promise<RunProgress> {
  const objective = input.objective.trim();
  if (objective.length < 10) {
    throw errors.validation('Describe the objective in a little more detail.');
  }

  const periodStart = await assertWithinQuota(input.workspaceId);
  const model = await pickModel();
  const provider = getProvider(model.providerKey);
  if (!provider) throw errors.providerUnavailable(model.providerKey, model.key);

  const tools = await usableTools(input.workspaceId);
  const toolList =
    tools.length > 0
      ? `Tools available: ${tools.map((tool) => tool.name).join(', ')}.`
      : 'No tools are available. Plan only model and research steps.';

  const runId = newId('agentRun');
  const maxSteps = clampSteps(input.maxSteps);
  const maxCostMicroUsd = clampCost(input.maxCostMicroUsd);

  // The row exists before the model call, so a failure mid-planning leaves a
  // visible failed run rather than nothing at all (D9).
  await db.insert(agentRuns).values({
    id: runId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    objective,
    status: 'planning',
    maxSteps,
    maxCostUsd: (maxCostMicroUsd / USD).toFixed(2),
    startedAt: new Date(),
  });

  try {
    const result = await provider.generate({
      modelIdentifier: model.modelIdentifier,
      messages: [
        { role: 'user', content: [{ type: 'text', text: `${objective}\n\n${toolList}` }] },
      ],
      system: PLAN_PROMPT,
      maxOutputTokens: 2_000,
      temperature: 0,
    });

    await recordUsage({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      model,
      usage: result.usage,
      kind: 'agent',
      operation: 'Agent planning',
      autoRouted: true,
      periodStart,
    });

    const plan = parsePlan(result.text, objective);
    if (!plan) {
      await failRun(runId, 'NO_PLAN', 'The model did not return a plan that could be read.');
      return {
        runId,
        status: 'failed',
        stepsExecuted: 0,
        totalSteps: 0,
        detail: 'No plan could be produced.',
      };
    }

    const capped = plan.steps.slice(0, maxSteps);

    await db.transaction(async (tx) => {
      for (const [index, step] of capped.entries()) {
        await tx.insert(agentSteps).values({
          id: newId('agentStep'),
          agentRunId: runId,
          workspaceId: input.workspaceId,
          stepIndex: index,
          title: step.title,
          description: step.description ?? null,
          kind: step.kind,
          toolName: step.toolName ?? null,
          status: 'pending',
        });
      }

      await tx
        .update(agentRuns)
        .set({
          status: 'running',
          plan: { objective: plan.objective, steps: capped },
          totalSteps: capped.length,
        })
        .where(eq(agentRuns.id, runId));
    });

    /**
     * Hand the run to the worker.
     *
     * Planning happens inline because the user is waiting to see the plan;
     * execution does not, because it is a loop of model calls that may pause
     * for a day on an approval. A web request is the wrong place for it.
     *
     * A failure to enqueue does not fail the run: the row is durable and the
     * UI can still drive it step by step, so degrading to manual is better
     * than discarding a plan the user already has (D9).
     */
    try {
      const jobId = await enqueue({
        kind: 'agent_run',
        workspaceId: input.workspaceId,
        userId: input.userId,
        payload: {
          agentRunId: runId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          objective: plan.objective,
        },
      });
      await db.update(agentRuns).set({ jobId }).where(eq(agentRuns.id, runId));
    } catch (error) {
      logger.warn('Agent run planned but could not be queued; it can be advanced manually', {
        runId,
        error,
      });
    }

    logger.info('Agent run planned', { runId, steps: capped.length });

    return {
      runId,
      status: 'running',
      stepsExecuted: 0,
      totalSteps: capped.length,
      detail: `Planned ${capped.length} steps.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(runId, 'PLAN_FAILED', message);
    throw error;
  }
}

async function failRun(runId: string, code: string, message: string): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: 'failed', errorCode: code, errorMessage: message, completedAt: new Date() })
    .where(eq(agentRuns.id, runId));
}

/**
 * Execute at most one step.
 *
 * Returns as soon as the run needs anything it cannot decide alone — a budget
 * refusal, an approval, or completion. Callers loop; this function never does,
 * because a loop here is exactly the runaway the budget exists to stop.
 */
export async function advanceRun(
  runId: string,
  workspaceId: string,
  actingUserId: string,
): Promise<RunProgress> {
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)))
    .limit(1);

  if (!run) throw errors.notFound('Agent run', runId);

  if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') {
    return {
      runId,
      status: run.status,
      stepsExecuted: run.stepsExecuted,
      totalSteps: run.totalSteps,
      detail: 'This run has finished.',
    };
  }

  // Checked before the step, never after: discovering the budget is gone once
  // the call is paid for is not a budget.
  const budget = checkBudget({
    maxSteps: run.maxSteps,
    stepsExecuted: run.stepsExecuted,
    maxCostMicroUsd: parseBudget(run.maxCostUsd),
    spentMicroUsd: 0,
  });

  if (!budget.allowed) {
    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        errorCode: budget.verdict.toUpperCase(),
        errorMessage: budget.reason,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
    return {
      runId,
      status: 'failed',
      stepsExecuted: run.stepsExecuted,
      totalSteps: run.totalSteps,
      detail: budget.reason,
    };
  }

  const [step] = await db
    .select()
    .from(agentSteps)
    .where(and(eq(agentSteps.agentRunId, runId), eq(agentSteps.status, 'pending')))
    .orderBy(asc(agentSteps.stepIndex))
    .limit(1);

  if (!step) {
    await db
      .update(agentRuns)
      .set({ status: 'succeeded', completedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    return {
      runId,
      status: 'succeeded',
      stepsExecuted: run.stepsExecuted,
      totalSteps: run.totalSteps,
      detail: 'All steps completed.',
    };
  }

  // ---- Tool steps: the ones that can need consent -----------------------
  if (step.kind === 'tool' && step.toolName) {
    const tools = await usableTools(workspaceId);
    const tool = tools.find((candidate) => candidate.name === step.toolName);

    if (!tool) {
      // A plan naming a tool that does not exist is a plan that cannot run.
      await db
        .update(agentSteps)
        .set({
          status: 'failed',
          errorMessage: `No enabled tool named "${step.toolName}".`,
          completedAt: new Date(),
        })
        .where(eq(agentSteps.id, step.id));
      await failRun(runId, 'UNKNOWN_TOOL', `The plan referenced an unavailable tool.`);
      return {
        runId,
        status: 'failed',
        stepsExecuted: run.stepsExecuted,
        totalSteps: run.totalSteps,
        detail: `The plan referenced "${step.toolName}", which is not enabled.`,
      };
    }

    const payload = (step.input ?? {}) as Record<string, unknown>;

    if (requiresApproval(tool.riskClass as RiskClass)) {
      const [existing] = await db
        .select()
        .from(agentApprovals)
        .where(eq(agentApprovals.agentStepId, step.id))
        .limit(1);

      const verdict = checkApproval({
        record: existing
          ? {
              status: existing.status,
              payload: existing.payload,
              expiresAt: existing.expiresAt,
              decidedAt: existing.decidedAt,
            }
          : undefined,
        payload,
      });

      if (!verdict.mayExecute) {
        // Create the request the first time; afterwards just report why it is
        // still blocked, so a denial is not silently re-asked forever.
        let approvalId = existing?.id;

        if (!existing) {
          approvalId = newId('agentApproval');
          await db.insert(agentApprovals).values({
            id: approvalId,
            agentRunId: runId,
            agentStepId: step.id,
            workspaceId,
            action: describeAction({
              action: step.title,
              reason: verdict.reason,
              riskClass: tool.riskClass as RiskClass,
              payload,
            }),
            reason: `Runs "${tool.name}", which changes data.`,
            riskClass: tool.riskClass,
            // Recorded so execution can prove it is running what was approved.
            payload,
            status: 'pending',
            expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
          });
        }

        const blocked = verdict.outcome === 'denied' ? 'failed' : 'awaiting_approval';

        await db
          .update(agentRuns)
          .set({
            status: blocked,
            ...(blocked === 'failed'
              ? { errorCode: 'DENIED', errorMessage: verdict.reason, completedAt: new Date() }
              : {}),
          })
          .where(eq(agentRuns.id, runId));

        return {
          runId,
          status: blocked,
          stepsExecuted: run.stepsExecuted,
          totalSteps: run.totalSteps,
          detail: verdict.reason,
          awaitingApprovalId: blocked === 'awaiting_approval' ? approvalId : undefined,
        };
      }
    }

    const started = Date.now();
    await db
      .update(agentSteps)
      .set({ status: 'running', startedAt: new Date(), attempts: step.attempts + 1 })
      .where(eq(agentSteps.id, step.id));

    // The MCP engine runs again here regardless of the agent's own approval:
    // two independent gates, and neither trusts the other's decision.
    const result = await executeTool({
      toolId: tool.id,
      workspaceId,
      userId: actingUserId,
      args: payload,
      approved: true,
    });

    await db
      .update(agentSteps)
      .set({
        status: result.status === 'succeeded' ? 'succeeded' : 'failed',
        output: result.output ?? null,
        errorMessage: result.status === 'succeeded' ? null : result.reason,
        durationMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(agentSteps.id, step.id));

    await db
      .update(agentRuns)
      .set({ stepsExecuted: run.stepsExecuted + 1, currentStepIndex: step.stepIndex + 1 })
      .where(eq(agentRuns.id, runId));

    return {
      runId,
      status: 'running',
      stepsExecuted: run.stepsExecuted + 1,
      totalSteps: run.totalSteps,
      detail: `${step.title}: ${result.status}`,
    };
  }

  // ---- Model steps -------------------------------------------------------
  // Re-checked here, not just at planning: a run can sit paused on an approval
  // for a day, during which the workspace may exhaust its quota elsewhere.
  const stepPeriodStart = await assertWithinQuota(workspaceId);
  const model = await pickModel();
  const provider = getProvider(model.providerKey);
  if (!provider) throw errors.providerUnavailable(model.providerKey, model.key);

  const started = Date.now();
  await db
    .update(agentSteps)
    .set({ status: 'running', startedAt: new Date(), attempts: step.attempts + 1 })
    .where(eq(agentSteps.id, step.id));

  try {
    const result = await provider.generate({
      modelIdentifier: model.modelIdentifier,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Objective: ${run.objective}\n\nStep: ${step.title}\n${step.description ?? ''}`,
            },
          ],
        },
      ],
      system:
        'You are executing one step of a larger plan. Do that step and report the result. ' +
        'Be concise and factual. If you cannot do it, say so plainly rather than inventing a result.',
      maxOutputTokens: 3_000,
    });

    await recordUsage({
      workspaceId,
      userId: actingUserId,
      model,
      usage: result.usage,
      kind: 'agent',
      operation: `Agent step: ${step.title.slice(0, 60)}`,
      autoRouted: true,
      periodStart: stepPeriodStart,
      jobId: run.jobId,
    });

    await db
      .update(agentSteps)
      .set({
        status: 'succeeded',
        output: result.text,
        modelKey: model.key,
        durationMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(agentSteps.id, step.id));

    await db
      .update(agentRuns)
      .set({ stepsExecuted: run.stepsExecuted + 1, currentStepIndex: step.stepIndex + 1 })
      .where(eq(agentRuns.id, runId));

    return {
      runId,
      status: 'running',
      stepsExecuted: run.stepsExecuted + 1,
      totalSteps: run.totalSteps,
      detail: step.title,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(agentSteps)
      .set({
        status: 'failed',
        errorMessage: message,
        durationMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(agentSteps.id, step.id));
    await failRun(runId, 'STEP_FAILED', message);
    return {
      runId,
      status: 'failed',
      stepsExecuted: run.stepsExecuted,
      totalSteps: run.totalSteps,
      detail: message,
    };
  }
}

/** Record a human decision. The run resumes on the next `advanceRun`. */
export async function decideApproval(params: {
  approvalId: string;
  workspaceId: string;
  userId: string;
  approve: boolean;
  denialReason?: string | undefined;
}): Promise<void> {
  const [approval] = await db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.id, params.approvalId),
        eq(agentApprovals.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);

  if (!approval) throw errors.notFound('Approval', params.approvalId);
  if (approval.status !== 'pending') {
    throw errors.validation('That approval has already been decided.');
  }

  await db
    .update(agentApprovals)
    .set({
      status: params.approve ? 'approved' : 'denied',
      decidedBy: params.userId,
      decidedAt: new Date(),
      denialReason: params.approve ? null : (params.denialReason ?? 'Denied by the user.'),
    })
    .where(eq(agentApprovals.id, params.approvalId));

  await db
    .update(agentRuns)
    .set({ status: params.approve ? 'running' : 'cancelled', ...(params.approve ? {} : { cancelledAt: new Date() }) })
    .where(eq(agentRuns.id, approval.agentRunId));
}

export async function cancelRun(runId: string, workspaceId: string): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: 'cancelled', cancelledAt: new Date(), completedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)));
}
