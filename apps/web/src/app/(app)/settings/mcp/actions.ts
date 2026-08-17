'use server';

import { revalidatePath } from 'next/cache';
import {
  approveToolSchema,
  connectServer,
  deleteServer,
  rediscoverTools,
  setToolEnabled,
} from '@reklu/mcp';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface McpFormState {
  readonly error?: string;
  readonly serverId?: string;
  readonly notice?: string;
}

/** Turn any failure into a readable sentence without leaking internals. */
function toMessage(error: unknown, fallback: string): string {
  if (isRekluError(error)) return error.userMessage;
  // McpError messages are written for users and name the actual problem.
  if (error instanceof Error && error.name === 'McpError') return error.message;
  return fallback;
}

export async function connectServerAction(
  _prev: McpFormState,
  formData: FormData,
): Promise<McpFormState> {
  const { user, workspace } = await getAppContext();

  const name = String(formData.get('name') ?? '').trim();
  const endpoint = String(formData.get('endpoint') ?? '').trim();
  const credential = String(formData.get('credential') ?? '').trim();

  if (!endpoint) return { error: 'Enter the server endpoint URL.' };

  try {
    const connected = await connectServer({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      name,
      endpoint,
      credential: credential || undefined,
    });
    revalidatePath('/settings/mcp');
    return {
      serverId: connected.serverId,
      notice: `Found ${connected.toolCount} tools. None are enabled yet — review them below.`,
    };
  } catch (error) {
    logger.warn('MCP connection failed', { error });
    return { error: toMessage(error, 'That server could not be connected.') };
  }
}

export async function setToolEnabledAction(
  toolId: string,
  enabled: boolean,
  autoApproveReads?: boolean,
): Promise<McpFormState> {
  const { workspace } = await getAppContext();
  try {
    await setToolEnabled({
      toolId,
      workspaceId: workspace.workspaceId,
      enabled,
      autoApproveReads,
    });
    revalidatePath('/settings/mcp', 'layout');
    return {};
  } catch (error) {
    return { error: toMessage(error, 'That tool could not be updated.') };
  }
}

export async function approveSchemaAction(serverId: string): Promise<McpFormState> {
  const { user, workspace } = await getAppContext();
  try {
    await approveToolSchema({ serverId, workspaceId: workspace.workspaceId, userId: user.id });
    revalidatePath('/settings/mcp', 'layout');
    return { notice: 'Tool definitions approved.' };
  } catch (error) {
    return { error: toMessage(error, 'The definitions could not be approved.') };
  }
}

export async function rediscoverAction(serverId: string): Promise<McpFormState> {
  const { workspace } = await getAppContext();
  try {
    const result = await rediscoverTools(serverId, workspace.workspaceId);
    revalidatePath('/settings/mcp', 'layout');

    if (!result.changed) return { notice: 'No changes. Tools match what you approved.' };

    const parts = [
      result.added.length > 0 ? `added ${result.added.join(', ')}` : '',
      result.removed.length > 0 ? `removed ${result.removed.join(', ')}` : '',
      result.modified.length > 0 ? `changed ${result.modified.join(', ')}` : '',
    ].filter(Boolean);

    return { notice: `This server ${parts.join('; ')}. Review and approve before using it again.` };
  } catch (error) {
    return { error: toMessage(error, 'The server could not be re-checked.') };
  }
}

export async function deleteServerAction(serverId: string): Promise<McpFormState> {
  const { workspace } = await getAppContext();
  try {
    await deleteServer(serverId, workspace.workspaceId);
    revalidatePath('/settings/mcp', 'layout');
    return {};
  } catch (error) {
    return { error: toMessage(error, 'The server could not be removed.') };
  }
}
