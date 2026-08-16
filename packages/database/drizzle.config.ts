import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is required to run drizzle-kit. Copy .env.example to .env at the repo root.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  // Keep generated SQL readable — these migrations get reviewed.
  verbose: true,
  strict: true,
});
