'use server';

import { revalidatePath } from 'next/cache';
import {
  createSkill,
  deleteSkill,
  duplicateSkill,
  installSkill,
  parseVariables,
  publishSkill,
  reviseSkill,
  rollbackSkill,
  uninstallSkill,
  unpublishSkill,
  upgradeInstall,
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
    variables: parseVariables(text('variables')),
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

export async function rollbackSkillAction(
  skillId: string,
  versionId: string,
): Promise<SkillFormState> {
  const { user, workspace } = await getAppContext();
  try {
    await rollbackSkill({ skillId, workspaceId: workspace.workspaceId, userId: user.id, versionId });
    revalidatePath(`/skills/${skillId}`);
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The version could not be restored.' };
  }
}

export async function setVisibilityAction(
  skillId: string,
  makePublic: boolean,
): Promise<SkillFormState> {
  const { workspace } = await getAppContext();
  try {
    if (makePublic) {
      await publishSkill({ skillId, workspaceId: workspace.workspaceId });
    } else {
      await unpublishSkill({ skillId, workspaceId: workspace.workspaceId });
    }
    revalidatePath(`/skills/${skillId}`);
    revalidatePath('/skills');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The visibility could not be changed.' };
  }
}

export async function installSkillAction(skillId: string): Promise<SkillFormState> {
  const { user, workspace } = await getAppContext();
  try {
    await installSkill({ skillId, workspaceId: workspace.workspaceId, userId: user.id });
    revalidatePath('/skills');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The skill could not be installed.' };
  }
}

export async function uninstallSkillAction(skillId: string): Promise<SkillFormState> {
  const { workspace } = await getAppContext();
  try {
    await uninstallSkill({ skillId, workspaceId: workspace.workspaceId });
    revalidatePath('/skills');
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The skill could not be uninstalled.' };
  }
}

export async function upgradeInstallAction(skillId: string): Promise<SkillFormState> {
  const { workspace } = await getAppContext();
  try {
    await upgradeInstall({ skillId, workspaceId: workspace.workspaceId });
    revalidatePath(`/skills/${skillId}`);
    return {};
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    return { error: 'The skill could not be upgraded.' };
  }
}
