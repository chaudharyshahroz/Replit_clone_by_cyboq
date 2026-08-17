/**
 * Creating and revising skills (spec §41).
 *
 * Versions are append-only, for the same reason artifacts and build
 * checkpoints are: a skill someone installed must not change under them.
 * Editing publishes a new version; installs stay pinned to the version they
 * chose until the installer upgrades deliberately.
 */
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, skillInstalls, skillVersions, skills } from '@reklu/database';
import { errors, newId } from '@reklu/shared';
import { assertUsableHandle, toHandle } from './handles';
import type { SkillExample, SkillVariable } from './invoke';

export interface SkillDraft {
  readonly name: string;
  readonly handle?: string | undefined;
  readonly description: string;
  readonly category?: string | undefined;
  readonly icon?: string | undefined;
  readonly instructions: string;
  readonly knowledge?: string | undefined;
  readonly examples?: readonly SkillExample[] | undefined;
  readonly variables?: readonly SkillVariable[] | undefined;
  readonly preferredModelKey?: string | undefined;
  readonly allowedToolNames?: readonly string[] | undefined;
}

const MIN_INSTRUCTIONS = 20;

function validate(draft: SkillDraft): void {
  if (draft.name.trim().length < 3) {
    throw errors.validation('Give the skill a name of at least 3 characters.', {
      name: ['Give the skill a name of at least 3 characters.'],
    });
  }
  if (draft.description.trim().length < 10) {
    throw errors.validation('Describe what the skill does, in at least 10 characters.', {
      description: ['Describe what the skill does, in at least 10 characters.'],
    });
  }
  if (draft.instructions.trim().length < MIN_INSTRUCTIONS) {
    // A skill with no real instructions produces worse output than no skill,
    // and the user would have no way to tell why.
    throw errors.validation(
      `Instructions need at least ${MIN_INSTRUCTIONS} characters to be useful.`,
      { instructions: [`Instructions need at least ${MIN_INSTRUCTIONS} characters.`] },
    );
  }
}

/** A handle free within this workspace, appending a counter only if needed. */
async function availableHandle(workspaceId: string, desired: string): Promise<string> {
  const root = assertUsableHandle(desired);

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(
        and(
          eq(skills.handle, candidate),
          isNull(skills.deletedAt),
          // Built-ins have no workspace but share the invocation namespace.
          or(eq(skills.workspaceId, workspaceId), isNull(skills.workspaceId)),
        ),
      )
      .limit(1);
    if (!taken) return candidate;
  }
  return `${root}-${newId('skill').slice(-6)}`;
}

export interface CreatedSkill {
  readonly skillId: string;
  readonly versionId: string;
  readonly handle: string;
}

export async function createSkill(params: {
  workspaceId: string;
  userId: string;
  draft: SkillDraft;
}): Promise<CreatedSkill> {
  validate(params.draft);

  const handle = await availableHandle(
    params.workspaceId,
    params.draft.handle?.trim() || toHandle(params.draft.name),
  );

  const skillId = newId('skill');
  const versionId = newId('skillVersion');

  await db.transaction(async (tx) => {
    await tx.insert(skills).values({
      id: skillId,
      workspaceId: params.workspaceId,
      authorId: params.userId,
      name: params.draft.name.trim(),
      handle,
      description: params.draft.description.trim(),
      icon: params.draft.icon ?? 'sparkles',
      category: (params.draft.category ?? 'other') as 'other',
      isBuiltIn: false,
      visibility: 'private',
      currentVersionId: versionId,
    });

    await tx.insert(skillVersions).values({
      id: versionId,
      skillId,
      version: 1,
      instructions: params.draft.instructions.trim(),
      knowledge: params.draft.knowledge?.trim() ?? null,
      examples: [...(params.draft.examples ?? [])],
      variables: [...(params.draft.variables ?? [])],
      preferredModelKey: params.draft.preferredModelKey ?? null,
      allowedToolNames: [...(params.draft.allowedToolNames ?? [])],
      changelog: 'Initial version',
      createdById: params.userId,
    });

    // The author's own workspace gets it installed, so it is invocable at once.
    await tx.insert(skillInstalls).values({
      id: newId('skillInstall'),
      skillId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      skillVersionId: versionId,
    });
  });

  return { skillId, versionId, handle };
}

/**
 * Publish a new version.
 *
 * Never mutates the existing version row. Installs that pinned the old one
 * keep working exactly as before until they upgrade.
 */
export async function reviseSkill(params: {
  skillId: string;
  workspaceId: string;
  userId: string;
  draft: SkillDraft;
  changelog?: string | undefined;
}): Promise<{ versionId: string; version: number }> {
  validate(params.draft);

  const [existing] = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.id, params.skillId),
        eq(skills.workspaceId, params.workspaceId),
        isNull(skills.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) throw errors.notFound('Skill', params.skillId);
  if (existing.isBuiltIn) {
    // Built-ins are Reklu's; duplicating one gives the user their own copy.
    throw errors.validation('Built-in skills cannot be edited. Duplicate it first.');
  }

  const [latest] = await db
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, params.skillId))
    .orderBy(desc(skillVersions.version))
    .limit(1);

  const version = (latest?.version ?? 0) + 1;
  const versionId = newId('skillVersion');

  await db.transaction(async (tx) => {
    await tx.insert(skillVersions).values({
      id: versionId,
      skillId: params.skillId,
      version,
      instructions: params.draft.instructions.trim(),
      knowledge: params.draft.knowledge?.trim() ?? null,
      examples: [...(params.draft.examples ?? [])],
      variables: [...(params.draft.variables ?? [])],
      preferredModelKey: params.draft.preferredModelKey ?? null,
      allowedToolNames: [...(params.draft.allowedToolNames ?? [])],
      changelog: params.changelog?.trim() || `Version ${version}`,
      createdById: params.userId,
    });

    await tx
      .update(skills)
      .set({
        name: params.draft.name.trim(),
        description: params.draft.description.trim(),
        icon: params.draft.icon ?? existing.icon,
        category: (params.draft.category ?? existing.category) as 'other',
        currentVersionId: versionId,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, params.skillId));
  });

  return { versionId, version };
}

/** Copy a skill — the only way to modify a built-in. */
export async function duplicateSkill(params: {
  skillId: string;
  workspaceId: string;
  userId: string;
}): Promise<CreatedSkill> {
  const [row] = await db
    .select({ skill: skills, version: skillVersions })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(and(eq(skills.id, params.skillId), isNull(skills.deletedAt)))
    .limit(1);

  if (!row) throw errors.notFound('Skill', params.skillId);

  // Built-ins and public skills are readable by anyone; a private skill from
  // another workspace is not.
  const readable =
    row.skill.isBuiltIn ||
    row.skill.visibility === 'public' ||
    row.skill.workspaceId === params.workspaceId;
  if (!readable) throw errors.notFound('Skill', params.skillId);

  return createSkill({
    workspaceId: params.workspaceId,
    userId: params.userId,
    draft: {
      name: `${row.skill.name} (copy)`,
      description: row.skill.description,
      category: row.skill.category,
      icon: row.skill.icon ?? undefined,
      instructions: row.version.instructions,
      knowledge: row.version.knowledge ?? undefined,
      examples: row.version.examples as SkillExample[],
      variables: row.version.variables as SkillVariable[],
      preferredModelKey: row.version.preferredModelKey ?? undefined,
      allowedToolNames: row.version.allowedToolNames,
    },
  });
}

export async function deleteSkill(params: {
  skillId: string;
  workspaceId: string;
}): Promise<void> {
  const [existing] = await db
    .select({ isBuiltIn: skills.isBuiltIn })
    .from(skills)
    .where(and(eq(skills.id, params.skillId), eq(skills.workspaceId, params.workspaceId)))
    .limit(1);

  if (!existing) throw errors.notFound('Skill', params.skillId);
  if (existing.isBuiltIn) throw errors.validation('Built-in skills cannot be deleted.');

  // Soft delete: conversations reference skills that ran, and a hard delete
  // would leave that history dangling.
  await db
    .update(skills)
    .set({ deletedAt: new Date() })
    .where(eq(skills.id, params.skillId));
}

export interface SkillListItem {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string | null;
  readonly isBuiltIn: boolean;
  readonly isOwn: boolean;
  readonly version: number | null;
  readonly updatedAt: Date;
}

/** Built-ins plus this workspace's own skills. */
export async function listSkills(workspaceId: string): Promise<SkillListItem[]> {
  const rows = await db
    .select({
      id: skills.id,
      handle: skills.handle,
      name: skills.name,
      description: skills.description,
      category: skills.category,
      icon: skills.icon,
      isBuiltIn: skills.isBuiltIn,
      workspaceId: skills.workspaceId,
      version: skillVersions.version,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .leftJoin(skillVersions, eq(skills.currentVersionId, skillVersions.id))
    .where(
      and(
        isNull(skills.deletedAt),
        or(isNull(skills.workspaceId), eq(skills.workspaceId, workspaceId)),
      ),
    )
    .orderBy(asc(skills.category), asc(skills.name));

  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    isBuiltIn: row.isBuiltIn,
    isOwn: row.workspaceId === workspaceId,
    version: row.version,
    updatedAt: row.updatedAt,
  }));
}

/** Version history, newest first. */
export async function listVersions(skillId: string): Promise<
  Array<{ id: string; version: number; changelog: string | null; createdAt: Date }>
> {
  return db
    .select({
      id: skillVersions.id,
      version: skillVersions.version,
      changelog: skillVersions.changelog,
      createdAt: skillVersions.createdAt,
    })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.version))
    .limit(50);
}

/** Record that a skill ran, for the library's usage ordering. */
export async function recordSkillUse(skillId: string, workspaceId: string): Promise<void> {
  await db
    .update(skillInstalls)
    .set({ lastUsedAt: new Date(), useCount: sql`${skillInstalls.useCount} + 1` })
    .where(
      and(eq(skillInstalls.skillId, skillId), eq(skillInstalls.workspaceId, workspaceId)),
    );
}
