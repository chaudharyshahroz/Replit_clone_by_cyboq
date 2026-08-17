/**
 * Driving an agent run to completion (spec §62–§63, §109).
 *
 * This is what makes an agent autonomous rather than a step-through debugger.
 * Without it a run only advances when someone clicks, which is a plan viewer
 * with extra steps.
 *
 * The loop lives *here*, not inside `advanceRun`, and that separation is the
 * whole design: `advanceRun` executes exactly one step and returns, so the
 * decision to take another step is always made by something that can also
 * decide to stop. Three things stop it, and all three are normal outcomes
 * rather than errors:
 *
 *   - the run finished
 *   - the run is waiting for a human
 *   - the run hit its step or cost ceiling
 *
 * A worker that treated "waiting for approval" as a failure would either spin
 * or mark a perfectly healthy run as broken.
 */
import { advanceRun, getRun } from '@reklu/agents';
import { logger } from '@reklu/shared';
import type { JobContext } from '@reklu/queue';

/** States from which no further step can be taken by this worker. */
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * A hard iteration cap, independent of the run's own step ceiling.
 *
 * The run's ceiling is enforced inside `advanceRun`, and this exists in case
 * that ever fails to advance — a handler that loops without the step counter
 * moving would spin forever. Belt and braces on the one loop in the system
 * that spends money.
 */
const MAX_ITERATIONS = 200;

export async function agentRunHandler(
  context: JobContext<'agent_run'>,
): Promise<{ runId: string; status: string; stepsExecuted: number }> {
  const { agentRunId, workspaceId, userId } = context.payload;

  await context.reportStage('planning');

  const initial = await getRun(agentRunId, workspaceId);
  if (!initial) {
    // The run was deleted between enqueue and execution. Nothing to do, and
    // nothing wrong — failing the job would just create noise.
    logger.warn('Agent run vanished before the worker reached it', { agentRunId });
    return { runId: agentRunId, status: 'cancelled', stepsExecuted: 0 };
  }

  await context.reportStage('executing');

  let status = initial.status;
  let stepsExecuted = initial.stepsExecuted;
  let lastSteps = -1;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (TERMINAL.has(status) || status === 'awaiting_approval') break;

    /**
     * Cooperative cancellation, checked between steps rather than during one.
     *
     * Throws `JobCancelledError`, which the worker turns into a cancelled job.
     * Checking here means a user who cancels waits at most one step, not the
     * whole plan — and a step already in flight still finishes cleanly rather
     * than leaving a half-written row.
     */
    await context.throwIfCancelled();

    const progress = await advanceRun(agentRunId, workspaceId, userId);
    status = progress.status;

    /**
     * If a call reports the same step count as the previous one and the run is
     * still `running`, nothing moved. Continuing would be an infinite loop
     * against a database, so stop and say so rather than spin.
     */
    if (progress.stepsExecuted === lastSteps && status === 'running') {
      logger.error('Agent run stopped making progress', { agentRunId, stepsExecuted });
      break;
    }

    lastSteps = stepsExecuted;
    stepsExecuted = progress.stepsExecuted;
  }

  await context.reportStage('finalizing');

  logger.info('Agent run handler finished', { agentRunId, status, stepsExecuted });

  // `awaiting_approval` is a successful outcome for this job: the run reached
  // a point only a person can pass, and the job's work is genuinely done.
  return { runId: agentRunId, status, stepsExecuted };
}
