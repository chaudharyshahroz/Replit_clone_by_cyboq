/**
 * Resolving an `@handle` in a message to a skill this workspace may invoke.
 *
 * Scope is enforced here, once: built-ins, public skills, and this workspace's
 * own. A private skill from another workspace is not merely hidden from the
 * list — it cannot be invoked by guessing its handle either.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, skillVersions, skills } from '@reklu/database';
import { parseMentions } from './handles';
import type { InvocableSkill, SkillExample, SkillVariable } from './invoke';

export async function resolveHandles(
  handles: readonly string[],
  workspaceId: string,
): Promise<InvocableSkill[]> {
  if (handles.length === 0) return [];

  const rows = await db
    .select({
      id: skills.id,
      handle: skills.handle,
      name: skills.name,
      description: skills.description,
      isBuiltIn: skills.isBuiltIn,
      instructions: skillVersions.instructions,
      knowledge: skillVersions.knowledge,
      examples: skillVersions.examples,
      variables: skillVersions.variables,
      preferredModelKey: skillVersions.preferredModelKey,
    })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(
      and(
        inArray(skills.handle, [...handles]),
        isNull(skills.deletedAt),
        or(
          isNull(skills.workspaceId),
          eq(skills.workspaceId, workspaceId),
          eq(skills.visibility, 'public'),
        ),
      ),
    );

  // Preserve the order the user typed them in.
  const byHandle = new Map(rows.map((row) => [row.handle, row]));
  return handles
    .map((handle) => byHandle.get(handle))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      knowledge: row.knowledge ?? undefined,
      examples: (row.examples ?? []) as SkillExample[],
      variables: (row.variables ?? []) as SkillVariable[],
      preferredModelKey: row.preferredModelKey ?? undefined,
      isBuiltIn: row.isBuiltIn,
    }));
}

export interface ResolvedInvocation {
  readonly skills: readonly InvocableSkill[];
  /** Handles that matched nothing this workspace can reach. */
  readonly unknownHandles: readonly string[];
}

/**
 * Only the first mention applies.
 *
 * Two skills in one turn would produce contradictory instructions with no way
 * for the user to predict which won. One invocation, stated plainly, beats a
 * merge nobody can reason about.
 */
export const MAX_SKILLS_PER_TURN = 1;

export async function resolveInvocation(
  message: string,
  workspaceId: string,
): Promise<ResolvedInvocation> {
  const mentioned = parseMentions(message);
  if (mentioned.length === 0) return { skills: [], unknownHandles: [] };

  const found = await resolveHandles(mentioned, workspaceId);
  const foundHandles = new Set(found.map((skill) => skill.handle));

  return {
    skills: found.slice(0, MAX_SKILLS_PER_TURN),
    unknownHandles: mentioned.filter((handle) => !foundHandles.has(handle)),
  };
}
