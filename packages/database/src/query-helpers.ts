/**
 * Query helpers that make the schema's invariants hard to forget.
 *
 * Soft deletion and workspace scoping are only safe if *every* query applies
 * them. These helpers exist so the correct thing is also the shortest thing to
 * type, and so a reviewer can grep for the ones that are missing.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/** `deleted_at IS NULL`. Required on every read of a soft-deletable table. */
export function notDeleted(column: PgColumn): SQL {
  return isNull(column);
}

/**
 * The standard tenancy predicate: this row belongs to this workspace and is not
 * deleted. Prefer this over hand-writing the pair.
 */
export function inWorkspace(
  workspaceColumn: PgColumn,
  workspaceId: string,
  deletedAtColumn?: PgColumn,
): SQL {
  const predicate = eq(workspaceColumn, workspaceId);
  return deletedAtColumn
    ? (and(predicate, isNull(deletedAtColumn)) as SQL)
    : predicate;
}

/** Cosine distance against a pgvector column. Smaller is more similar. */
export function cosineDistance(column: PgColumn, embedding: readonly number[]): SQL<number> {
  return sql<number>`${column} <=> ${toVectorLiteral(embedding)}::vector`;
}

/** Cosine *similarity* in [0,1], for thresholding and display. */
export function cosineSimilarity(column: PgColumn, embedding: readonly number[]): SQL<number> {
  return sql<number>`1 - (${column} <=> ${toVectorLiteral(embedding)}::vector)`;
}

/**
 * pgvector's text input format. Built as a bound parameter rather than
 * interpolated, so a crafted embedding cannot become SQL.
 */
export function toVectorLiteral(embedding: readonly number[]): string {
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding contains a non-finite value; refusing to build a vector literal.');
    }
  }
  return `[${embedding.join(',')}]`;
}

export interface PaginationInput {
  readonly limit?: number;
  readonly cursor?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
  readonly hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/** Clamp a client-supplied page size; an unbounded limit is a denial-of-service. */
export function pageSize(requested?: number): number {
  if (!requested || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

/**
 * Build a page from `limit + 1` rows. Cursor pagination (not OFFSET) because
 * conversation and activity lists grow without bound and OFFSET degrades badly.
 */
export function toPage<T extends { id: string }>(rows: readonly T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

/** Assert a table has a workspace column — a guard used by tenancy tests. */
export function hasWorkspaceScope(table: PgTable): boolean {
  return 'workspaceId' in table;
}
