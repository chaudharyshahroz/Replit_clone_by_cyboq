/**
 * Authorization.
 *
 * Every protected resource resolves through here. The rule the codebase relies
 * on: a caller proves membership of the workspace that owns a row *before* the
 * row is returned — authorization is never inferred from the absence of a UI
 * affordance (spec §84).
 */
import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  projectMembers,
  projects,
  workspaceMembers,
  workspaces,
  type Project,
  type User,
  type WorkspaceRole,
} from '@reklu/database';
import { errors } from '@reklu/shared';

/** Ordered so comparisons are a simple numeric test. */
const ROLE_RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

export function roleSatisfies(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export interface WorkspaceAccess {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly role: WorkspaceRole;
  readonly isPersonal: boolean;
}

/**
 * Assert the user is a member of the workspace, with at least `required` role.
 *
 * Throws NOT_FOUND rather than FORBIDDEN when the user is not a member: telling
 * a stranger that a workspace exists is itself a disclosure.
 */
export async function requireWorkspace(
  user: User,
  workspaceId: string,
  required: WorkspaceRole = 'member',
): Promise<WorkspaceAccess> {
  const rows = await db
    .select({
      role: workspaceMembers.role,
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      isPersonal: workspaces.isPersonal,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, user.id),
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw errors.notFound('Workspace', workspaceId);

  if (!roleSatisfies(row.role, required)) {
    throw errors.forbidden(
      `User ${user.id} has role ${row.role} in ${workspaceId}, needs ${required}`,
      `This action requires the ${required} role in this workspace.`,
    );
  }

  return {
    workspaceId: row.id,
    workspaceSlug: row.slug,
    workspaceName: row.name,
    role: row.role,
    isPersonal: row.isPersonal,
  };
}

/** Every workspace the user belongs to, for the workspace switcher. */
export async function listWorkspaces(user: User): Promise<readonly WorkspaceAccess[]> {
  const rows = await db
    .select({
      role: workspaceMembers.role,
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      isPersonal: workspaces.isPersonal,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, user.id), isNull(workspaces.deletedAt)));

  return rows.map((row) => ({
    workspaceId: row.id,
    workspaceSlug: row.slug,
    workspaceName: row.name,
    role: row.role,
    isPersonal: row.isPersonal,
  }));
}

/**
 * Resolve a project the user may read.
 *
 * Workspace membership is necessary but not sufficient: a `private` project is
 * visible only to its explicit members, so the visibility check happens here
 * rather than being left to each caller to remember.
 */
export async function requireProject(user: User, projectId: string): Promise<Project> {
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  const project = rows[0]?.project;
  if (!project) throw errors.notFound('Project', projectId);

  if (project.visibility === 'private') {
    const membership = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
      .limit(1);

    const isCreator = project.createdBy === user.id;
    if (membership.length === 0 && !isCreator) {
      throw errors.notFound('Project', projectId);
    }
  }

  return project;
}

/** Platform super-admin gate (spec §78). */
export function requireSuperAdmin(user: User): void {
  if (!user.isSuperAdmin) {
    // Deliberately a 404 shape: admin routes should not confirm they exist.
    throw errors.notFound('Page');
  }
}
