/**
 * The database package shipped with no tests at all.
 *
 * That went unnoticed because vitest exits non-zero on "no test files found",
 * and every green run of the suite had been served from the turbo cache — so
 * the one package holding the tenancy and SQL-injection guards was also the
 * one package proving nothing.
 *
 * These cover the pure surface: the vector literal builder (which takes
 * caller-supplied numbers straight into SQL text), the page-size clamp, cursor
 * pagination, and the workspace-scope sweep that `hasWorkspaceScope`'s own
 * comment says exists.
 */
import { describe, expect, it } from 'vitest';
import {
  hasWorkspaceScope,
  pageSize,
  toPage,
  toVectorLiteral,
} from '../query-helpers';
import * as schema from '../schema';

describe('toVectorLiteral', () => {
  it('formats an embedding as pgvector text', () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe('[0.5,-1,0]');
  });

  it('accepts an empty embedding', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });

  /**
   * NaN and Infinity serialise as bare words, so an unchecked value would
   * reach Postgres as `[NaN]` — a syntax error at best, and a hole in the
   * "bound parameter, never interpolated" claim at worst.
   */
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('refuses a %s component', (_label, value) => {
    expect(() => toVectorLiteral([0.1, value])).toThrow(/non-finite/);
  });
});

describe('pageSize', () => {
  it('defaults when nothing is requested', () => {
    expect(pageSize()).toBe(30);
    expect(pageSize(undefined)).toBe(30);
  });

  it.each([0, -1, -1000])('defaults on a non-positive request (%i)', (requested) => {
    expect(pageSize(requested)).toBe(30);
  });

  it('honours a reasonable request', () => {
    expect(pageSize(10)).toBe(10);
  });

  // An unbounded limit is a denial-of-service, not a feature request.
  it('clamps an oversized request', () => {
    expect(pageSize(5000)).toBe(100);
    expect(pageSize(101)).toBe(100);
  });
});

describe('toPage', () => {
  const rows = (count: number): { id: string }[] =>
    Array.from({ length: count }, (_, index) => ({ id: `row_${index}` }));

  it('reports no more pages when the extra row is absent', () => {
    const page = toPage(rows(3), 5);
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  /**
   * The caller fetches limit + 1 rows; the extra row is the signal, and must
   * never be handed to the client.
   */
  it('drops the probe row and returns the last kept id as the cursor', () => {
    const page = toPage(rows(6), 5);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('row_4');
    expect(page.items.map((row) => row.id)).not.toContain('row_5');
  });

  it('treats an exactly-full page as the last page', () => {
    const page = toPage(rows(5), 5);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('handles an empty result', () => {
    const page = toPage([], 5);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});

describe('workspace scoping', () => {
  /**
   * Tables that are deliberately not workspace-scoped, each for a stated
   * reason. The first version of this list was simply incomplete and reported
   * three correct tables as violations — an allowlist without reasons is how a
   * check like this gets suppressed instead of fixed.
   */
  const GLOBAL_TABLES = new Set([
    // Identity and tenancy themselves: a workspace cannot be scoped to one.
    'users', 'sessions', 'accounts', 'verificationTokens',
    'workspaces', 'workspaceMembers', 'invitations',
    // Catalogue rows shared by every workspace. Usage against them
    // (aiRequests) is scoped; the catalogue is not.
    'aiProviders', 'aiModels', 'plans', 'featureFlags',
    /*
     * Written before there is an account, let alone a workspace. Somebody on
     * the waitlist has given an email address and nothing else — there is no
     * tenant to scope them to, and inventing one to satisfy this rule would
     * create a workspace for a person who has never signed in.
     */
    'waitlistSignups',
  ]);

  /**
   * Child tables that inherit scope through their parent's foreign key.
   * skillVersions belongs to a skill, and skills carries workspaceId — adding
   * a second copy of the column would let the two disagree.
   */
  const CHILD_SCOPED = new Map([['skillVersions', 'skillId']]);

  const tables = Object.entries(schema).filter(
    ([, value]) =>
      typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
  );

  it('finds the schema tables', () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  /**
   * Tenancy is only as good as its least careful table: one workspace-scoped
   * table missing `workspaceId` is a cross-tenant read waiting to be written.
   */
  it('every non-global table carries a workspace column', () => {
    const unscoped = tables
      .filter(([name]) => !GLOBAL_TABLES.has(name))
      .filter(([name]) => !CHILD_SCOPED.has(name))
      .filter(([, table]) => !hasWorkspaceScope(table as never))
      .map(([name]) => name);

    expect(unscoped).toEqual([]);
  });

  it('every child-scoped table really has the parent key it claims', () => {
    for (const [name, parentKey] of CHILD_SCOPED) {
      const table = Object.fromEntries(tables)[name];
      expect(table, `${name} is missing from the schema`).toBeDefined();
      expect(parentKey in (table as object), `${name} has no ${parentKey}`).toBe(true);
    }
  });
});
