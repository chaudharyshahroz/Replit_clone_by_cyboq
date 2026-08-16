'use server';

import { revalidatePath } from 'next/cache';
import { restoreVersion } from '@reklu/artifacts';
import { getAppContext } from '@/lib/auth-context';

export async function restoreVersionAction(artifactId: string, version: number): Promise<void> {
  const { user, workspace } = await getAppContext();
  await restoreVersion({ artifactId, workspaceId: workspace.workspaceId, userId: user.id, version });
  revalidatePath(`/artifacts/${artifactId}`);
}
