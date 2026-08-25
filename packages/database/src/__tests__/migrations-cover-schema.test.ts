/**
 * Every column the code expects must be created by some migration.
 *
 * `build_log` was added to `publications` by editing the migration that creates
 * that table — a file that had already been applied to a live database. Drizzle
 * decides what to run from the journal's timestamps, not from the contents of a
 * file it has already seen, so the edit changed nothing anywhere it mattered:
 * a fresh database got the column, every existing one did not, and the schema
 * and the migrations disagreed with no test able to notice.
 *
 * The rule this enforces is the one that was broken: a shipped migration is
 * history and does not get edited. New columns arrive in new files.
 */
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

async function migrationSql(): Promise<string> {
  const names = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort();
  const files = await Promise.all(
    names.map((name) => readFile(new URL(name, MIGRATIONS), 'utf8')),
  );
  return files.join('\n');
}

/** Drizzle keeps the real column name on a symbol-keyed config object. */
function columnsOf(table: unknown): string[] {
  const columns = Object.values(table as Record<string, unknown>).filter(
    (value): value is { name: string } =>
      typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string',
  );
  return columns.map((column) => column.name);
}

describe('the migrations and the schema', () => {
  it('create every column the schema declares', async () => {
    const sql = await migrationSql();

    const missing: string[] = [];
    for (const [name, table] of Object.entries(schema)) {
      if (typeof table !== 'object' || table === null) continue;
      if (!(Symbol.for('drizzle:Name') in table)) continue;

      for (const column of columnsOf(table)) {
        /*
         * Matched on the quoted name as the migrations write it. Loose enough
         * to accept a CREATE TABLE or an ALTER, and strict enough that a column
         * mentioned nowhere is caught.
         */
        if (!sql.includes(`"${column}"`)) missing.push(`${name}.${column}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('lists every migration file in the journal', async () => {
    /*
     * A file the journal does not name is never applied, however correct it is
     * — which looks exactly like a migration that ran and did nothing.
     */
    const journal = JSON.parse(
      await readFile(new URL('meta/_journal.json', MIGRATIONS), 'utf8'),
    ) as { entries: { tag: string }[] };

    const files = (await readdir(MIGRATIONS))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort();

    expect(journal.entries.map((entry) => entry.tag).sort()).toEqual(files);
  });
});
