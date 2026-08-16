import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve a possibly-relative local storage path to an absolute one, anchored
 * at the monorepo root rather than the process working directory.
 *
 * Why this exists: `STORAGE_LOCAL_PATH=./.storage` resolved against `cwd` puts
 * uploads in `apps/web/.storage` when the web app writes them and
 * `apps/worker/.storage` when the worker looks for them. Two stores, one of
 * them always empty — a file would upload successfully and then be invisible to
 * the job meant to index it.
 */
export function resolveLocalStorageRoot(configuredPath: string): string {
  if (isAbsolute(configuredPath)) return configuredPath;
  return resolve(monorepoRoot(), configuredPath);
}

let cachedRoot: string | undefined;

/** Walk up from this file until the workspace manifest appears. */
function monorepoRoot(): string {
  if (cachedRoot) return cachedRoot;

  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(resolve(directory, 'pnpm-workspace.yaml'))) {
      cachedRoot = directory;
      return cachedRoot;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // Falling back to cwd would silently reintroduce the split-store bug, so
  // fail loudly instead.
  throw new Error(
    'Could not locate the monorepo root (no pnpm-workspace.yaml found above ' +
      '@reklu/storage). Set STORAGE_LOCAL_PATH to an absolute path.',
  );
}
