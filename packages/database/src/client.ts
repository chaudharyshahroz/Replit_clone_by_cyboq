/**
 * Database client.
 *
 * A single pooled connection per process, cached across hot reloads in
 * development so Next.js's module re-evaluation does not exhaust Postgres
 * connections — a classic dev-only outage that looks like a production bug.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadServerEnv, logger } from '@reklu/shared';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

interface DatabaseHandle {
  readonly db: Database;
  readonly sql: postgres.Sql;
}

const globalForDb = globalThis as unknown as { __rekluDb?: DatabaseHandle };

function create(): DatabaseHandle {
  const env = loadServerEnv();

  const sql = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
    // Reklu runs its own structured logger; postgres.js notices are noise.
    onnotice: () => {},
    transform: { undefined: null },
  });

  const db = drizzle(sql, {
    schema,
    logger:
      env.LOG_LEVEL === 'trace'
        ? {
            logQuery(query, params) {
              // `redact` in the logger scrubs anything secret-shaped in params.
              logger.trace('sql', { query, params });
            },
          }
        : false,
  });

  return { db, sql };
}

function handle(): DatabaseHandle {
  if (!globalForDb.__rekluDb) {
    globalForDb.__rekluDb = create();
  }
  return globalForDb.__rekluDb;
}

/** The Drizzle client. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(handle().db as object, prop, receiver);
  },
});

/** Raw postgres.js handle, for `LISTEN`/`NOTIFY`, vector queries, and migrations. */
export function rawSql(): postgres.Sql {
  return handle().sql;
}

/** Close the pool. Called from worker shutdown and test teardown. */
export async function closeDatabase(): Promise<void> {
  const existing = globalForDb.__rekluDb;
  if (!existing) return;
  await existing.sql.end({ timeout: 5 });
  globalForDb.__rekluDb = undefined;
}

/** Liveness probe used by /api/health and by the worker's readiness gate. */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  vectorEnabled: boolean;
  error?: string;
}> {
  const started = Date.now();
  try {
    const sql = rawSql();
    const rows = await sql<{ has_vector: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS has_vector
    `;
    return {
      ok: true,
      latencyMs: Date.now() - started,
      vectorEnabled: rows[0]?.has_vector ?? false,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      vectorEnabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
