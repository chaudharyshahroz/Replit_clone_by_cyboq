'use server';

import { revalidatePath } from 'next/cache';
import { revokeConnection, verifyConnection } from '@reklu/integrations';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface ConnectionActionState {
  readonly error?: string;
  readonly message?: string;
}

/**
 * Disconnect. Workspace id comes from the session, never from the form, so a
 * forged connection id cannot reach another tenant's row.
 */
export async function disconnectAction(
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const { workspace } = await getAppContext();
  const connectionId = String(formData.get('connectionId') ?? '');
  if (!connectionId) return { error: 'No connection was specified.' };

  try {
    await revokeConnection(connectionId, workspace.workspaceId);
    revalidatePath('/settings/connections');
    return { message: 'Disconnected. The stored credentials have been deleted.' };
  } catch (error) {
    logger.warn('Disconnect failed', { error });
    return { error: isRekluError(error) ? error.userMessage : 'Could not disconnect.' };
  }
}

/** Re-check a stored token against the provider and record what came back. */
export async function verifyAction(
  _prev: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const { workspace } = await getAppContext();
  const connectionId = String(formData.get('connectionId') ?? '');
  if (!connectionId) return { error: 'No connection was specified.' };

  try {
    const works = await verifyConnection(connectionId, workspace.workspaceId);
    revalidatePath('/settings/connections');
    return works
      ? { message: 'Connection verified — the provider accepted the stored credentials.' }
      : { error: 'The provider rejected the stored credentials. Reconnect to continue.' };
  } catch (error) {
    logger.warn('Verify failed', { error });
    return { error: isRekluError(error) ? error.userMessage : 'Could not verify the connection.' };
  }
}
