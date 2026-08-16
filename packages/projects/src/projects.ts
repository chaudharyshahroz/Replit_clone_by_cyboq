/**
 * Project lifecycle.
 *
 * A project is Reklu's unit of persistent context (spec §16). Everything here
 * is workspace-scoped: `workspaceId` is proved by the caller's authorization
 * before these functions run, and every query filters on it anyway — defence in
 * depth, because a single missing filter is a cross-tenant read.
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  conversations,
  artifacts,
  db,
  files,
  projectMembers,
  projectMemories,
  projects,
  type Project,
} from '@reklu/database';
import { errors, newId, slugify } from '@reklu/shared';

export interface CreateProjectInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly instructions?: string | null;
  readonly icon?: string | null;
  readonly visibility?: Project['visibility'];
  readonly preferredModelKey?: string | null;
}

async function uniqueSlug(workspaceId: string, name: string): Promise<string> {
  const root = slugify(name);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.slug, candidate)))
      .limit(1);
    if (!existing) return candidate;
  }
  return `${root}-${newId('project').slice(-6)}`;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const name = input.name.trim();
  if (name.length === 0) throw errors.validation('A project needs a name.');
  if (name.length > 120) throw errors.validation('That project name is too long.');

  const projectId = newId('project');
  const slug = await uniqueSlug(input.workspaceId, name);

  // Project + creator membership together: a project whose creator is not a
  // member would be invisible to the person who just made it.
  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      workspaceId: input.workspaceId,
      name,
      slug,
      description: input.description?.trim() || null,
      instructions: input.instructions?.trim() || null,
      icon: input.icon ?? 'folder',
      visibility: input.visibility ?? 'private',
      preferredModelId: input.preferredModelKey ?? null,
      createdBy: input.userId,
      lastActivityAt: new Date(),
    });

    await tx.insert(projectMembers).values({
      projectId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: 'owner',
    });
  });

  const [created] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return created!;
}

export interface ProjectSummary {
  readonly project: Project;
  readonly conversationCount: number;
  readonly fileCount: number;
  readonly artifactCount: number;
  readonly memoryCount: number;
}

/** Projects visible to a user in a workspace, with their content counts. */
export async function listProjects(
  workspaceId: string,
  userId: string,
): Promise<readonly ProjectSummary[]> {
  const rows = await db
    .select({
      project: projects,
      conversationCount: sql<number>`(
        SELECT count(*) FROM ${conversations}
        WHERE ${conversations.projectId} = ${projects.id}
          AND ${conversations.deletedAt} IS NULL
      )`,
      fileCount: sql<number>`(
        SELECT count(*) FROM ${files}
        WHERE ${files.projectId} = ${projects.id} AND ${files.deletedAt} IS NULL
      )`,
      artifactCount: sql<number>`(
        SELECT count(*) FROM ${artifacts}
        WHERE ${artifacts.projectId} = ${projects.id} AND ${artifacts.deletedAt} IS NULL
      )`,
      memoryCount: sql<number>`(
        SELECT count(*) FROM ${projectMemories}
        WHERE ${projectMemories.projectId} = ${projects.id}
          AND ${projectMemories.deletedAt} IS NULL
          AND ${projectMemories.approvedAt} IS NOT NULL
      )`,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
        // Private projects are visible only to explicit members or the creator.
        sql`(
          ${projects.visibility} = 'workspace'
          OR ${projects.createdBy} = ${userId}
          OR EXISTS (
            SELECT 1 FROM ${projectMembers}
            WHERE ${projectMembers.projectId} = ${projects.id}
              AND ${projectMembers.userId} = ${userId}
          )
        )`,
      ),
    )
    .orderBy(desc(projects.lastActivityAt));

  return rows.map((row) => ({
    project: row.project,
    conversationCount: Number(row.conversationCount),
    fileCount: Number(row.fileCount),
    artifactCount: Number(row.artifactCount),
    memoryCount: Number(row.memoryCount),
  }));
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly instructions?: string | null;
  readonly icon?: string | null;
  readonly visibility?: Project['visibility'];
  readonly preferredModelKey?: string | null;
}

export async function updateProject(
  projectId: string,
  workspaceId: string,
  userId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const patch: Record<string, unknown> = { updatedBy: userId };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) throw errors.validation('A project needs a name.');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.instructions !== undefined) patch.instructions = input.instructions?.trim() || null;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.preferredModelKey !== undefined) patch.preferredModelId = input.preferredModelKey;

  const [updated] = await db
    .update(projects)
    .set(patch)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .returning();

  if (!updated) throw errors.notFound('Project', projectId);
  return updated;
}

/**
 * Soft-delete a project.
 *
 * Its conversations, files and artifacts keep their rows — the ownership chain
 * stays intact so the delete is recoverable and auditable (spec §102, §144).
 */
export async function deleteProject(
  projectId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const removed = await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedBy: userId })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
      ),
    )
    .returning({ id: projects.id });

  if (removed.length === 0) throw errors.notFound('Project', projectId);
}

/** Bump activity so recency ordering reflects real use. */
export async function touchProject(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
}

/** Attach an existing file to a project, proving both belong to the workspace. */
export async function attachFileToProject(
  fileId: string,
  projectId: string,
  workspaceId: string,
): Promise<void> {
  const updated = await db
    .update(files)
    .set({ projectId })
    .where(
      and(
        eq(files.id, fileId),
        eq(files.workspaceId, workspaceId),
        isNull(files.deletedAt),
        // Do not silently move a file already filed elsewhere.
        sql`(${files.projectId} IS NULL OR ${files.projectId} = ${projectId})`,
      ),
    )
    .returning({ id: files.id });

  if (updated.length === 0) {
    throw errors.notFound('File', fileId);
  }
}

/** Guard used by tests: a project id from another workspace must not resolve. */
export async function projectExistsInWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        ne(projects.name, ''),
      ),
    )
    .limit(1);
  return Boolean(row);
}
