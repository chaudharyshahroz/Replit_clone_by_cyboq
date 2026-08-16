/**
 * Build checkpoints (spec §33).
 *
 * Every meaningful AI change writes an immutable version holding the **whole
 * file tree**, not a diff. That is deliberate: a model asked to "make the
 * header smaller" can delete routing, and recovering from that must not depend
 * on replaying a chain of diffs that may themselves be wrong.
 *
 * Restoring is itself a new version, so an unwanted restore is also undoable —
 * the same rule as artifact versions.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  buildFiles,
  buildProjects,
  buildVersions,
  db,
  type BuildVersion,
} from '@reklu/database';
import { errors, newId } from '@reklu/shared';
import type { GeneratedFile } from './parse';

export interface CheckpointInput {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly files: readonly GeneratedFile[];
  /** What the user asked for. */
  readonly prompt?: string | null;
  readonly changeSummary: string;
  readonly modelKey?: string | null;
  /** Whether the generated tree actually built. */
  readonly checksPassed?: boolean | null;
  readonly checkOutput?: string | null;
}

export interface Checkpoint {
  readonly version: BuildVersion;
  readonly fileCount: number;
  readonly changedPaths: readonly string[];
}

/**
 * Write a checkpoint.
 *
 * The version number is computed inside the transaction, so two concurrent
 * generations cannot claim the same number — the unique index rejects the
 * loser, which is correct rather than silently overwriting.
 */
export async function createCheckpoint(input: CheckpointInput): Promise<Checkpoint> {
  if (input.files.length === 0) {
    throw errors.validation('A checkpoint needs at least one file.');
  }

  const versionId = newId('buildVersion');

  const changedPaths = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: buildProjects.id, currentVersionId: buildProjects.currentVersionId })
      .from(buildProjects)
      .where(
        and(
          eq(buildProjects.id, input.buildProjectId),
          eq(buildProjects.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);

    if (!project) throw errors.notFound('Build project', input.buildProjectId);

    // Compare against the previous tree so the changed-file list is real
    // rather than "everything the model happened to emit".
    const previous = project.currentVersionId
      ? await tx
          .select({ path: buildFiles.path, content: buildFiles.content })
          .from(buildFiles)
          .where(eq(buildFiles.buildVersionId, project.currentVersionId))
      : [];

    const previousByPath = new Map(previous.map((file) => [file.path, file.content ?? '']));
    const changed = input.files
      .filter((file) => previousByPath.get(file.path) !== file.content)
      .map((file) => file.path);

    const [highest] = await tx
      .select({ max: sql<number>`coalesce(max(${buildVersions.version}), 0)` })
      .from(buildVersions)
      .where(eq(buildVersions.buildProjectId, input.buildProjectId));

    const nextVersion = Number(highest?.max ?? 0) + 1;

    await tx.insert(buildVersions).values({
      id: versionId,
      buildProjectId: input.buildProjectId,
      workspaceId: input.workspaceId,
      version: nextVersion,
      prompt: input.prompt ?? null,
      changeSummary: input.changeSummary,
      changedPaths: changed,
      modelKey: input.modelKey ?? null,
      createdById: input.userId,
      checksPassed: input.checksPassed ?? null,
      checkOutput: input.checkOutput ?? null,
    });

    // The full tree, so restore never depends on replaying diffs.
    await tx.insert(buildFiles).values(
      input.files.map((file) => ({
        id: newId('buildFile'),
        buildProjectId: input.buildProjectId,
        buildVersionId: versionId,
        workspaceId: input.workspaceId,
        path: file.path,
        content: file.content,
        sizeBytes: Buffer.byteLength(file.content),
        language: file.language,
        isBinary: false,
        isGenerated: true,
      })),
    );

    await tx
      .update(buildProjects)
      .set({
        currentVersionId: versionId,
        versionCount: nextVersion,
        lastBuiltAt: new Date(),
        updatedBy: input.userId,
      })
      .where(eq(buildProjects.id, input.buildProjectId));

    return changed;
  });

  const [version] = await db
    .select()
    .from(buildVersions)
    .where(eq(buildVersions.id, versionId))
    .limit(1);

  return {
    version: version!,
    fileCount: input.files.length,
    changedPaths,
  };
}

/** The file tree at a given version. */
export async function loadTree(
  buildProjectId: string,
  workspaceId: string,
  versionId?: string,
): Promise<readonly GeneratedFile[]> {
  let targetVersionId = versionId;

  if (!targetVersionId) {
    const [project] = await db
      .select({ currentVersionId: buildProjects.currentVersionId })
      .from(buildProjects)
      .where(
        and(eq(buildProjects.id, buildProjectId), eq(buildProjects.workspaceId, workspaceId)),
      )
      .limit(1);
    targetVersionId = project?.currentVersionId ?? undefined;
  }

  if (!targetVersionId) return [];

  const rows = await db
    .select({
      path: buildFiles.path,
      content: buildFiles.content,
      language: buildFiles.language,
    })
    .from(buildFiles)
    .where(
      and(
        eq(buildFiles.buildVersionId, targetVersionId),
        eq(buildFiles.workspaceId, workspaceId),
      ),
    )
    .orderBy(buildFiles.path);

  return rows.map((row) => ({
    path: row.path,
    content: row.content ?? '',
    language: row.language ?? 'text',
  }));
}

export async function listCheckpoints(
  buildProjectId: string,
  workspaceId: string,
): Promise<readonly BuildVersion[]> {
  return db
    .select()
    .from(buildVersions)
    .where(
      and(
        eq(buildVersions.buildProjectId, buildProjectId),
        eq(buildVersions.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(buildVersions.version));
}

/**
 * Restore a previous checkpoint.
 *
 * Implemented as a **new** version carrying the old tree, so the restore is
 * itself undoable and no work is destroyed.
 */
export async function restoreCheckpoint(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly version: number;
}): Promise<Checkpoint> {
  const [target] = await db
    .select()
    .from(buildVersions)
    .where(
      and(
        eq(buildVersions.buildProjectId, params.buildProjectId),
        eq(buildVersions.workspaceId, params.workspaceId),
        eq(buildVersions.version, params.version),
      ),
    )
    .limit(1);

  if (!target) throw errors.notFound('Build version', String(params.version));

  const files = await loadTree(params.buildProjectId, params.workspaceId, target.id);
  if (files.length === 0) {
    throw errors.validation(`Version ${params.version} has no files to restore.`);
  }

  return createCheckpoint({
    buildProjectId: params.buildProjectId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    files,
    changeSummary: `Restored version ${params.version}`,
  });
}
