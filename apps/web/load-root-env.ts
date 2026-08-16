/**
 * Load the monorepo-root `.env` into `process.env`.
 *
 * Next only auto-loads `.env` from the application directory, but Reklu keeps a
 * single root `.env` shared by the web app, the worker, and the database tools.
 *
 * Two deliberate rules:
 *   - Existing `process.env` values always win, so real deployment configuration
 *     is never overwritten by a stray checked-out file.
 *   - `NODE_ENV` is ignored entirely. Forcing it during `next build` yields a
 *     development React inside a production bundle, which fails at prerender.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED = new Set(['NODE_ENV']);

export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '..', '..', '.env');
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || IGNORED.has(key)) continue;
    if (process.env[key] !== undefined) continue;

    const rawValue = line.slice(eq + 1);
    const trimmed = rawValue.trim();

    // Quoted values are taken verbatim; unquoted values drop a trailing
    // ` # comment`. A `#` inside a token (a URL fragment) is preserved.
    const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
    process.env[key] = quoted
      ? quoted[2]
      : rawValue.replace(/(^|\s)#.*$/, '$1').trim();
  }
}
