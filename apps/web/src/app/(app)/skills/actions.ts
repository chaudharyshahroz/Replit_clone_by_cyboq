'use server';

import { revalidatePath } from 'next/cache';
import {
  createSkill,
  deleteSkill,
  duplicateSkill,
  reviseSkill,
  type SkillDraft,
} from '@reklu/skills';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface SkillFormState {
  readonly error?: string;
  readonly handle?: string;
}

function draftFrom(formData: FormData): SkillDraft {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  return {
    name: text('name'),
    description: text('description'),
    instructions: text('instructions'),
    knowledge: text('knowledge') || undefined,
    category: text('category') || 'other',
    preferredModelKey: text('preferredModelKey') || undefined,
  };
}

export async function createSkillAction(
  _prev: SkillFormState,
  formData: FormData,
): Promise<SkillFormState> {
  const { user, workspace } = await getAppContext();

  try {
    const created = await createSkill({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      draft: draftFrom(formData),
    });
    revalidatePath('/skills');
    return { handle: created.handle };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    logger.error('Skill creation failed', { error });
    return { error: 'The skill could not be created.' };
  }
}

export async function reviseSkillAction(
  skillId: string,
  _prev: SkillFormState,
  formData: FormData,
): Promise<SkillFormState> {
  const { user, workspace } = await getAppContext();

  try {
    await reviseSkill({
      skillId,
      workspaceId: workspace.workspaceId,
      userId: user.id,
      draft: draftFrom(formData),
      changelog: String(formData.get('changelog') ?? '').trim() || undefined,
    });
    revalidatePath('/skills');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    logger.error('Skill revision failed', { error, skillId });
    return { error: 'The skill could not be updated.' };
  }
}

export async function duplicateSkillAction(skillId: string): Promise<SkillFormState> {
  const { user, workspace } = await getAppContext();
  try {
    const copy = await duplicateSkill({
      skillId,
      workspaceId: workspace.workspaceId,
      userId: user.id,
    });
    revalidatePath('/skills');
    return { handle: copy.handle };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The skill could not be duplicated.' };
  }
}

export async function deleteSkillAction(skillId: string): Promise<SkillFormState> {
  const { workspace } = await getAppContext();
  try {
    await deleteSkill({ skillId, workspaceId: workspace.workspaceId });
    revalidatePath('/skills');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The skill could not be deleted.' };
  }
}
