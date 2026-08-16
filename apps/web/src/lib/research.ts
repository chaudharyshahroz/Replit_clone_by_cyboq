import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  db,
  researchCitations,
  researchSessions,
  researchSources,
  type ResearchSession,
  type ResearchSource,
  type User,
} from '@reklu/database';
import { errors } from '@reklu/shared';

export interface ResearchSummary {
  readonly id: string;
  readonly query: string;
  readonly mode: string;
  readonly stage: string;
  readonly sourcesUsed: number;
  readonly sourcesFailed: number;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly artifactId: string | null;
}

/**
 * Research history for the list screen.
 *
 * Scoped to the author *and* the workspace — a research session is private to
 * whoever ran it, as conversations are.
 */
export async function listResearch(
  user: User,
  workspaceId: string,
  limit = 50,
): Promise<readonly ResearchSummary[]> {
  const rows = await db
    .select()
    .from(researchSessions)
    .where(
      and(
        eq(researchSessions.userId, user.id),
        eq(researchSessions.workspaceId, workspaceId),
        isNull(researchSessions.deletedAt),
      ),
    )
    .orderBy(desc(researchSessions.createdAt))
    .limit(limit);

  return rows.map(toSummary);
}

function toSummary(row: ResearchSession): ResearchSummary {
  return {
    id: row.id,
    query: row.query,
    mode: row.mode,
    stage: row.stage,
    sourcesUsed: row.sourcesUsed,
    sourcesFailed: row.sourcesFailed,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    artifactId: row.artifactId,
  };
}

export interface SourceWithCitations extends ResearchSource {
  /** Claims this source was cited for, with the passage supporting each. */
  readonly citations: readonly { claim: string; passage: string | null }[];
}

export interface ResearchDetail {
  readonly session: ResearchSession;
  readonly sources: readonly SourceWithCitations[];
  /** Sources that could not be retrieved, kept visible rather than hidden. */
  readonly failedSources: readonly ResearchSource[];
}

export async function loadResearch(
  user: User,
  workspaceId: string,
  sessionId: string,
): Promise<ResearchDetail | undefined> {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(
      and(
        eq(researchSessions.id, sessionId),
        eq(researchSessions.userId, user.id),
        eq(researchSessions.workspaceId, workspaceId),
        isNull(researchSessions.deletedAt),
      ),
    )
    .limit(1);

  if (!session) return undefined;

  const [allSources, citations] = await Promise.all([
    db
      .select()
      .from(researchSources)
      .where(eq(researchSources.researchSessionId, sessionId))
      .orderBy(researchSources.citationIndex),
    db
      .select()
      .from(researchCitations)
      .where(eq(researchCitations.researchSessionId, sessionId)),
  ]);

  const citationsBySource = new Map<string, { claim: string; passage: string | null }[]>();
  for (const citation of citations) {
    const list = citationsBySource.get(citation.sourceId) ?? [];
    list.push({ claim: citation.claim, passage: citation.supportingPassage });
    citationsBySource.set(citation.sourceId, list);
  }

  return {
    session,
    sources: allSources
      .filter((source) => source.fetchError === null)
      .map((source) => ({
        ...source,
        citations: citationsBySource.get(source.id) ?? [],
      })),
    // Surfaced separately so "14 of 18 retrieved" is legible, not buried.
    failedSources: allSources.filter((source) => source.fetchError !== null),
  };
}

export async function deleteResearch(
  user: User,
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  const removed = await db
    .update(researchSessions)
    .set({ deletedAt: new Date(), updatedBy: user.id })
    .where(
      and(
        eq(researchSessions.id, sessionId),
        eq(researchSessions.userId, user.id),
        eq(researchSessions.workspaceId, workspaceId),
        isNull(researchSessions.deletedAt),
      ),
    )
    .returning({ id: researchSessions.id });

  if (removed.length === 0) throw errors.notFound('Research session', sessionId);
}
