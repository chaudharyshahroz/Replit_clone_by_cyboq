'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { approveMemory, createProject, forgetMemory, remember, updateProject, deleteProject } from '@reklu/projects';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface ProjectFormState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string[]>;
}

export async function createProjectAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { user, workspace } = await getAppContext();
  let slug: string;

  try {
    const project = await createProject({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      instructions: String(formData.get('instructions') ?? '') || null,
    });
    slug = project.id;
  } catch (error) {
    if (isRekluError(error)) {
      return {
        error: error.userMessage,
        fieldErrors: (error.context.fieldErrors as Record<string, string[]>) ?? undefined,
      };
    }
    logger.error('Project creation failed', { error });
    return { error: 'Could not create the project. Please try again.' };
  }

  redirect(`/projects/${slug}`);
}

export async function updateInstructionsAction(
  projectId: string,
  formData: FormData,
): Promise<void> {
  const { user, workspace } = await getAppContext();
  await updateProject(projectId, workspace.workspaceId, user.id, {
    instructions: String(formData.get('instructions') ?? ''),
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function addMemoryAction(projectId: string, formData: FormData): Promise<void> {
  const { user, workspace } = await getAppContext();
  const content = String(formData.get('content') ?? '').trim();
  if (content.length === 0) return;

  await remember({
    projectId,
    workspaceId: workspace.workspaceId,
    userId: user.id,
    // Typed by a human in the memory panel, so this is user-stated and
    // auto-approved. Only Reklu's own inferences need review.
    kind: (formData.get('kind') as 'fact' | 'preference' | 'decision') ?? 'fact',
    source: 'user',
    content,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function approveMemoryAction(projectId: string, memoryId: string): Promise<void> {
  const { user, workspace } = await getAppContext();
  await approveMemory(memoryId, workspace.workspaceId, user.id);
  revalidatePath(`/projects/${projectId}`);
}

export async function forgetMemoryAction(projectId: string, memoryId: string): Promise<void> {
  const { user, workspace } = await getAppContext();
  await forgetMemory(memoryId, workspace.workspaceId, user.id);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProjectAction(projectId: string): Promise<void> {
  const { user, workspace } = await getAppContext();
  await deleteProject(projectId, workspace.workspaceId, user.id);
  redirect('/projects');
}
