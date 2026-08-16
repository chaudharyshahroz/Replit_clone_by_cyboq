/**
 * Project memory (spec §18).
 *
 * Deliberately **not** an ever-growing transcript. Each memory is a discrete,
 * inspectable, individually removable claim that carries the source it came
 * from.
 *
 * Three rules define the design:
 *
 *  1. **Inferred memories are not trusted on sight.** Anything Reklu derived
 *     rather than being told starts unapproved and is excluded from context
 *     until a human confirms it. A model that can silently write its own
 *     long-term beliefs will eventually persist a hallucination and then cite
 *     itself.
 *  2. **Every memory carries provenance.** `sourceMessageId` / `sourceFileId` /
 *     `sourceResearchId` let the UI answer "why does Reklu think this?".
 *  3. **Retrieval is ranked, not exhaustive.** Context budget is finite;
 *     importance, recency and similarity decide what earns a place.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { embedOne, embeddingsAvailable } from '@reklu/ai';
import {
  cosineSimilarity,
  db,
  projectMemories,
  toVectorLiteral,
  type NewProjectMemory,
  type ProjectMemory,
} from '@reklu/database';
import { errors, logger, newId } from '@reklu/shared';

export type MemoryKind = ProjectMemory['kind'];
export type MemorySource = ProjectMemory['source'];

export interface RememberInput {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly kind: MemoryKind;
  readonly source: MemorySource;
  readonly content: string;
  readonly importance?: number;
  readonly sourceMessageId?: string | null;
  readonly sourceFileId?: string | null;
  readonly sourceResearchId?: string | null;
  readonly expiresAt?: Date | null;
  /** Required when `source` is 'user' — who stated it. */
  readonly userId?: string | null;
}

/**
 * Record a memory.
 *
 * User-stated memories are auto-approved: the user said it, so requiring them
 * to then approve their own statement would be theatre. Inferred and
 * system-derived memories are not.
 */
export async function remember(input: RememberInput): Promise<ProjectMemory> {
  const content = input.content.trim();
  if (content.length === 0) throw errors.validation('A memory cannot be empty.');
  if (content.length > 4_000) {
    throw errors.validation('That memory is too long. Summarize it to under 4000 characters.');
  }

  const autoApproved = input.source === 'user';
  const embedding = await embedOne(content).catch(() => undefined);

  const values: NewProjectMemory = {
    id: newId('projectMemory'),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    source: input.source,
    content,
    importance: input.importance ?? defaultImportance(input.kind),
    sourceMessageId: input.sourceMessageId ?? null,
    sourceFileId: input.sourceFileId ?? null,
    sourceResearchId: input.sourceResearchId ?? null,
    expiresAt: input.expiresAt ?? null,
    approvedAt: autoApproved ? new Date() : null,
    approvedBy: autoApproved ? (input.userId ?? null) : null,
    embedding: embedding ? [...embedding] : null,
  };

  const [row] = await db.insert(projectMemories).values(values).returning();
  return row!;
}

/** Instructions and explicit decisions outrank rolled-up summaries. */
function defaultImportance(kind: MemoryKind): number {
  switch (kind) {
    case 'instruction':
      return 0.95;
    case 'decision':
      return 0.8;
    case 'preference':
      return 0.7;
    case 'fact':
      return 0.6;
    case 'summary':
      return 0.4;
  }
}

/** Approve an inferred memory, admitting it to context. */
export async function approveMemory(
  memoryId: string,
  workspaceId: string,
  userId: string,
): Promise<ProjectMemory> {
  const [row] = await db
    .update(projectMemories)
    .set({ approvedAt: new Date(), approvedBy: userId })
    .where(
      and(
        eq(projectMemories.id, memoryId),
        eq(projectMemories.workspaceId, workspaceId),
        isNull(projectMemories.deletedAt),
      ),
    )
    .returning();

  if (!row) throw errors.notFound('Memory', memoryId);
  return row;
}

/** Remove a memory. Soft delete keeps the audit trail (spec §18: inspectable). */
export async function forgetMemory(
  memoryId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const removed = await db
    .update(projectMemories)
    .set({ deletedAt: new Date(), updatedBy: userId })
    .where(
      and(
        eq(projectMemories.id, memoryId),
        eq(projectMemories.workspaceId, workspaceId),
        isNull(projectMemories.deletedAt),
      ),
    )
    .returning({ id: projectMemories.id });

  if (removed.length === 0) throw errors.notFound('Memory', memoryId);
}

export interface MemoryListOptions {
  /** Include memories awaiting approval, for the review UI. */
  readonly includeUnapproved?: boolean;
  readonly limit?: number;
}

/** All memories for the inspection UI, newest first. */
export async function listMemories(
  projectId: string,
  workspaceId: string,
  options: MemoryListOptions = {},
): Promise<readonly ProjectMemory[]> {
  const conditions = [
    eq(projectMemories.projectId, projectId),
    eq(projectMemories.workspaceId, workspaceId),
    isNull(projectMemories.deletedAt),
  ];
  if (!options.includeUnapproved) {
    conditions.push(isNotNull(projectMemories.approvedAt));
  }

  return db
    .select()
    .from(projectMemories)
    .where(and(...conditions))
    .orderBy(desc(projectMemories.createdAt))
    .limit(options.limit ?? 200);
}

export interface RecalledMemory {
  readonly memory: ProjectMemory;
  readonly score: number;
  readonly matchedBy: 'semantic' | 'lexical' | 'always';
}

/**
 * Retrieve memories relevant to a query.
 *
 * Instructions are `always` included — a standing instruction that only applies
 * when it happens to resemble the question is not an instruction. Everything
 * else competes on relevance.
 *
 * Degrades to lexical matching when embeddings are unavailable, so a project
 * without an embedding key still gets *some* recall rather than none.
 */
export async function recall(params: {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly query: string;
  readonly limit?: number;
}): Promise<readonly RecalledMemory[]> {
  const limit = params.limit ?? 12;
  const now = new Date();

  const base = and(
    eq(projectMemories.projectId, params.projectId),
    eq(projectMemories.workspaceId, params.workspaceId),
    isNull(projectMemories.deletedAt),
    // Unapproved inferences never reach a prompt.
    isNotNull(projectMemories.approvedAt),
    // Time-bounded facts expire rather than misleading later. Uses gt() rather
    // than a sql`` fragment: postgres.js cannot bind a Date interpolated into a
    // template literal, which failed at runtime while typechecking cleanly.
    or(isNull(projectMemories.expiresAt), gt(projectMemories.expiresAt, now)),
  );

  const instructions = await db
    .select()
    .from(projectMemories)
    .where(and(base, eq(projectMemories.kind, 'instruction')))
    .orderBy(desc(projectMemories.importance))
    .limit(10);

  const results: RecalledMemory[] = instructions.map((memory) => ({
    memory,
    score: 1,
    matchedBy: 'always' as const,
  }));

  const remaining = Math.max(0, limit - results.length);
  if (remaining === 0) return results;

  const embedding = embeddingsAvailable() ? await embedOne(params.query) : undefined;

  if (embedding) {
    const similarity = cosineSimilarity(projectMemories.embedding, embedding);
    const rows = await db
      .select({ memory: projectMemories, similarity })
      .from(projectMemories)
      .where(
        and(
          base,
          ne(projectMemories.kind, 'instruction'),
          isNotNull(projectMemories.embedding),
        ),
      )
      // Rank by similarity weighted by importance — a highly relevant but
      // trivial note should not outrank a slightly less similar decision.
      .orderBy(sql`(${similarity}) * 0.75 + ${projectMemories.importance} * 0.25 DESC`)
      .limit(remaining);

    results.push(
      ...rows.map((row) => ({
        memory: row.memory,
        score: Number(row.similarity ?? 0),
        matchedBy: 'semantic' as const,
      })),
    );
    await touch(results.map((r) => r.memory.id));
    return results;
  }

  // Lexical fallback. Postgres full-text ranking over the memory content.
  const terms = params.query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 12);

  if (terms.length === 0) {
    logger.debug('Memory recall had no usable lexical terms', { projectId: params.projectId });
    return results;
  }

  const tsquery = terms.join(' | ');
  const rank = sql<number>`ts_rank(to_tsvector('english', ${projectMemories.content}), to_tsquery('english', ${tsquery}))`;

  const rows = await db
    .select({ memory: projectMemories, rank })
    .from(projectMemories)
    .where(
      and(
        base,
        ne(projectMemories.kind, 'instruction'),
        sql`to_tsvector('english', ${projectMemories.content}) @@ to_tsquery('english', ${tsquery})`,
      ),
    )
    .orderBy(sql`${rank} DESC, ${projectMemories.importance} DESC`)
    .limit(remaining);

  results.push(
    ...rows.map((row) => ({
      memory: row.memory,
      score: Number(row.rank ?? 0),
      matchedBy: 'lexical' as const,
    })),
  );

  await touch(results.map((r) => r.memory.id));
  return results;
}

/** Recency/frequency signal for future ranking. Best-effort. */
async function touch(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    // `inArray` binds parameters. Building `ARRAY['a','b']` with sql.raw would
    // work here (ids come from our own rows) but is the wrong habit: the same
    // shape applied to user input is an injection.
    await db
      .update(projectMemories)
      .set({
        accessCount: sql`${projectMemories.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(inArray(projectMemories.id, [...ids]));
  } catch (error) {
    // Never fail a user's request because a usage counter did not increment.
    logger.debug('Failed to update memory access counters', { error });
  }
}

/** Exposed for tests and for building vector literals in callers. */
export { toVectorLiteral };
