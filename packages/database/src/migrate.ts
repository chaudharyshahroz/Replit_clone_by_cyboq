/**
 * Migration runner.
 *
 * Run as a separate step before the app or worker starts (see docs/DEPLOYMENT.md)
 * rather than on process boot, so that N replicas starting at once do not race
 * to apply the same migration.
 */
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadServerEnv, logger } from '@reklu/shared';
import { closeDatabase, db, rawSql } from './client';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(here, '..', 'migrations');

/**
 * Extensions must exist before any migration references `vector`. This is
 * idempotent and safe to run on every deploy.
 */
async function ensureExtensions(): Promise<void> {
  const env = loadServerEnv();
  const sql = rawSql();

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  if (env.DATABASE_VECTOR_ENABLED) {
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    } catch (error) {
      // Fail loudly: silently continuing would produce a database whose
      // semantic-retrieval columns cannot exist, and the failure would only
      // surface much later as a confusing query error.
      throw new Error(
        'DATABASE_VECTOR_ENABLED=true but the pgvector extension could not be created. ' +
          'Install pgvector, or set DATABASE_VECTOR_ENABLED=false to run without ' +
          'semantic retrieval. See docs/LOCAL_SETUP.md.\n' +
          `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function migrate(): Promise<void> {
  const started = Date.now();
  logger.info('Running database migrations', { folder: MIGRATIONS_FOLDER });

  await ensureExtensions();
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  logger.info('Migrations complete', { durationMs: Date.now() - started });
}

// Executed directly via `pnpm db:migrate`.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  migrate()
    .then(() => closeDatabase())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      logger.error('Migration failed', { error });
      await closeDatabase().catch(() => {});
      process.exit(1);
    });
}
