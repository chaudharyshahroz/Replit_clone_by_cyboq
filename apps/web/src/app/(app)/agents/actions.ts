'use server';

import { revalidatePath } from 'next/cache';
import { advanceRun, cancelRun, decideApproval, startRun } from '@reklu/agents';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface AgentFormState {
  readonly error?: string;
  readonly runId?: string;
  readonly detail?: string;
  readonly submitted?: { readonly objective: string };
}

export async function startRunAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const { user, workspace } = await getAppContext();
  const objective = String(formData.get('objective') ?? '').trim();
  const submitted = { objective };

  try {
    const progress = await startRun({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      objective,
      maxSteps: Number(formData.get('maxSteps')) || undefined,
    });
    revalidatePath('/agents');
    return { runId: progress.runId, detail: progress.detail };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage, submitted };
    logger.error('Agent run failed to start', { error });
    return { error: 'The run could not be started.', submitted };
  }
}

/**
 * Advance one step.
 *
 * Deliberately one step per call: the loop lives with the caller, so a run
 * blocked on approval simply stops rather than spinning, and a runaway cannot
 * hide inside a single request.
 */
export async function advanceRunAction(runId: string): Promise<AgentFormState> {
  const { user, workspace } = await getAppContext();
  try {
    const progress = await advanceRun(runId, workspace.workspaceId, user.id);
    revalidatePath(`/agents/${runId}`);
    return { runId, detail: progress.detail };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    logger.error('Agent step failed', { error, runId });
    return { error: 'That step could not be run.' };
  }
}

export async function decideApprovalAction(
  approvalId: string,
  approve: boolean,
): Promise<AgentFormState> {
  const { user, workspace } = await getAppContext();
  try {
    await decideApproval({
      approvalId,
      workspaceId: workspace.workspaceId,
      userId: user.id,
      approve,
    });
    revalidatePath('/agents', 'layout');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'That decision could not be recorded.' };
  }
}

export async function cancelRunAction(runId: string): Promise<AgentFormState> {
  const { workspace } = await getAppContext();
  try {
    await cancelRun(runId, workspace.workspaceId);
    revalidatePath('/agents', 'layout');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The run could not be cancelled.' };
  }
}
