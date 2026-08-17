/**
 * Publishing and installing skills (spec §41).
 *
 * Installing pins a **version**, not a skill. An author who publishes a
 * revision does not change what an installer already runs — they have to
 * upgrade deliberately. That is the same append-only reasoning as artifacts
 * and build checkpoints, applied to something other people depend on.
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, skillInstalls, skillVersions, skills } from '@reklu/database';
import { errors, logger, newId } from '@reklu/shared';

/** Publish to the public library. */
export async function publishSkill(params: {
  skillId: string;
  workspaceId: string;
}): Promise<void> {
  const [skill] = await db
    .select({ isBuiltIn: skills.isBuiltIn, currentVersionId: skills.currentVersionId })
    .from(skills)
    .where(
      and(
        eq(skills.id, params.skillId),
        eq(skills.workspaceId, params.workspaceId),
        isNull(skills.deletedAt),
      ),
    )
    .limit(1);

  if (!skill) throw errors.notFound('Skill', params.skillId);
  if (skill.isBuiltIn) throw errors.validation('Built-in skills are already available to everyone.');
  if (!skill.currentVersionId) {
    throw errors.validation('This skill has no version to publish.');
  }

  await db
    .update(skills)
    .set({ visibility: 'public', publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(skills.id, params.skillId));

  logger.info('Skill published', { skillId: params.skillId });
}

/**
 * Withdraw from the public library.
 *
 * Existing installs keep working. Unpublishing removes it from discovery; it
 * does not reach into other workspaces and break something they rely on.
 */
export async function unpublishSkill(params: {
  skillId: string;
  workspaceId: string;
}): Promise<void> {
  const [skill] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.id, params.skillId), eq(skills.workspaceId, params.workspaceId)))
    .limit(1);

  if (!skill) throw errors.notFound('Skill', params.skillId);

  await db
    .update(skills)
    .set({ visibility: 'private', publishedAt: null, updatedAt: new Date() })
    .where(eq(skills.id, params.skillId));
}

export interface PublicSkill {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly installCount: number;
  readonly version: number | null;
  readonly installed: boolean;
}

/** The public library, excluding this workspace's own skills. */
export async function listPublicSkills(workspaceId: string): Promise<PublicSkill[]> {
  const rows = await db
    .select({
      id: skills.id,
      handle: skills.handle,
      name: skills.name,
      description: skills.description,
      category: skills.category,
      installCount: skills.installCount,
      version: skillVersions.version,
      installId: skillInstalls.id,
    })
    .from(skills)
    .leftJoin(skillVersions, eq(skills.currentVersionId, skillVersions.id))
    .leftJoin(
      skillInstalls,
      and(eq(skillInstalls.skillId, skills.id), eq(skillInstalls.workspaceId, workspaceId)),
    )
    .where(
      and(
        eq(skills.visibility, 'public'),
        isNull(skills.deletedAt),
        // Your own published skills are already in your library.
        ne(skills.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(skills.installCount))
    .limit(100);

  return rows.map((row) => ({
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    category: row.category,
    installCount: row.installCount,
    version: row.version,
    installed: row.installId !== null,
  }));
}

/**
 * Install a public skill, pinned to the version being installed.
 *
 * Note what is NOT granted here: `requestedMcpToolNames` on the version is
 * recorded as a request, and `grantedMcpToolIds` stays empty. Installing a
 * skill never silently widens tool access — that grant is a separate,
 * explicit act (spec §49).
 */
export async function installSkill(params: {
  skillId: string;
  workspaceId: string;
  userId: string;
}): Promise<{ installId: string; version: number | null }> {
  const [skill] = await db
    .select({
      id: skills.id,
      visibility: skills.visibility,
      isBuiltIn: skills.isBuiltIn,
      workspaceId: skills.workspaceId,
      currentVersionId: skills.currentVersionId,
    })
    .from(skills)
    .where(and(eq(skills.id, params.skillId), isNull(skills.deletedAt)))
    .limit(1);

  if (!skill) throw errors.notFound('Skill', params.skillId);

  const installable =
    skill.isBuiltIn ||
    skill.visibility === 'public' ||
    skill.workspaceId === params.workspaceId;
  // A private skill in another workspace is not merely hidden — it cannot be
  // installed by id either.
  if (!installable) throw errors.notFound('Skill', params.skillId);

  const [existing] = await db
    .select({ id: skillInstalls.id, skillVersionId: skillInstalls.skillVersionId })
    .from(skillInstalls)
    .where(
      and(
        eq(skillInstalls.skillId, params.skillId),
        eq(skillInstalls.workspaceId, params.workspaceId),
      ),
    )
    .limit(1);

  if (existing) {
    const [pinned] = await db
      .select({ version: skillVersions.version })
      .from(skillVersions)
      .where(eq(skillVersions.id, existing.skillVersionId ?? ''))
      .limit(1);
    return { installId: existing.id, version: pinned?.version ?? null };
  }

  const installId = newId('skillInstall');

  await db.transaction(async (tx) => {
    await tx.insert(skillInstalls).values({
      id: installId,
      skillId: params.skillId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      skillVersionId: skill.currentVersionId,
      grantedMcpToolIds: [],
    });

    await tx
      .update(skills)
      .set({ installCount: sql`${skills.installCount} + 1` })
      .where(eq(skills.id, params.skillId));
  });

  const [pinned] = await db
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.currentVersionId ?? ''))
    .limit(1);

  return { installId, version: pinned?.version ?? null };
}

export async function uninstallSkill(params: {
  skillId: string;
  workspaceId: string;
}): Promise<void> {
  const deleted = await db
    .delete(skillInstalls)
    .where(
      and(
        eq(skillInstalls.skillId, params.skillId),
        eq(skillInstalls.workspaceId, params.workspaceId),
      ),
    )
    .returning({ id: skillInstalls.id });

  if (deleted.length > 0) {
    await db
      .update(skills)
      // Never below zero, whatever the history of this row.
      .set({ installCount: sql`greatest(${skills.installCount} - 1, 0)` })
      .where(eq(skills.id, params.skillId));
  }
}

export interface InstallStatus {
  readonly installed: boolean;
  readonly pinnedVersion: number | null;
  readonly currentVersion: number | null;
  /** True when the author has published a newer version than the pin. */
  readonly upgradeAvailable: boolean;
}

export async function installStatus(
  skillId: string,
  workspaceId: string,
): Promise<InstallStatus> {
  const [row] = await db
    .select({
      installId: skillInstalls.id,
      pinnedVersionId: skillInstalls.skillVersionId,
      currentVersionId: skills.currentVersionId,
    })
    .from(skills)
    .leftJoin(
      skillInstalls,
      and(eq(skillInstalls.skillId, skills.id), eq(skillInstalls.workspaceId, workspaceId)),
    )
    .where(eq(skills.id, skillId))
    .limit(1);

  if (!row) return { installed: false, pinnedVersion: null, currentVersion: null, upgradeAvailable: false };

  const versions = await db
    .select({ id: skillVersions.id, version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId));

  const pinned = versions.find((v) => v.id === row.pinnedVersionId)?.version ?? null;
  const current = versions.find((v) => v.id === row.currentVersionId)?.version ?? null;

  return {
    installed: row.installId !== null,
    pinnedVersion: pinned,
    currentVersion: current,
    upgradeAvailable: pinned !== null && current !== null && current > pinned,
  };
}

/** Move an install to the skill's current version. Always deliberate. */
export async function upgradeInstall(params: {
  skillId: string;
  workspaceId: string;
}): Promise<{ version: number | null }> {
  const [skill] = await db
    .select({ currentVersionId: skills.currentVersionId })
    .from(skills)
    .where(eq(skills.id, params.skillId))
    .limit(1);

  if (!skill?.currentVersionId) throw errors.notFound('Skill', params.skillId);

  await db
    .update(skillInstalls)
    .set({ skillVersionId: skill.currentVersionId, updatedAt: new Date() })
    .where(
      and(
        eq(skillInstalls.skillId, params.skillId),
        eq(skillInstalls.workspaceId, params.workspaceId),
      ),
    );

  const [version] = await db
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.currentVersionId))
    .limit(1);

  return { version: version?.version ?? null };
}
