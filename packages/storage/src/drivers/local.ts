/**
 * Local filesystem driver — **development only**.
 *
 * `loadServerEnv()` refuses to start production with `STORAGE_DRIVER=local`, so
 * this never runs in a deployment. It exists so uploads, artifacts and exports
 * work on a laptop with no cloud credentials.
 *
 * Even here, every resolved path is re-checked to be inside the root: a key
 * validated at one layer and used at another is exactly where traversal bugs
 * survive.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assertSafeKey, safeDisplayFilename } from '../keys';
import { resolveLocalStorageRoot } from '../root';
import { StorageError, type GetResult, type PutOptions, type SignedUrlOptions, type StorageDriver, type StoredObject } from '../types';

interface LocalDriverOptions {
  readonly root: string;
  /** Origin used to build signed URLs, e.g. http://localhost:3000 */
  readonly appUrl: string;
}

export function createLocalDriver(options: LocalDriverOptions): StorageDriver {
  // Anchored at the monorepo root, not the process cwd — see root.ts.
  const root = resolveLocalStorageRoot(options.root);

  /** Resolve a key to an absolute path, proving it stays under the root. */
  function pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(root, key));
    const rel = relative(root, full);
    if (rel.startsWith('..') || rel.startsWith(sep) || resolve(root, rel) !== full) {
      throw new StorageError('INVALID_KEY', `Resolved path escapes the storage root: ${key}`);
    }
    return full;
  }

  /** Metadata sidecar, so content type survives a restart. */
  const metaPathFor = (key: string): string => `${pathFor(key)}.meta.json`;

  return {
    name: 'local',
    isDurable: false,

    async put(put: PutOptions): Promise<StoredObject> {
      const full = pathFor(put.key);
      await mkdir(dirname(full), { recursive: true });

      const body = Buffer.from(put.body);
      await writeFile(full, body);
      await writeFile(
        metaPathFor(put.key),
        JSON.stringify({
          contentType: put.contentType,
          filename: put.filename ? safeDisplayFilename(put.filename) : undefined,
          metadata: put.metadata ?? {},
        }),
      );

      return {
        key: put.key,
        size: body.byteLength,
        contentType: put.contentType,
        checksum: createHash('sha256').update(body).digest('hex'),
      };
    },

    async get(key: string): Promise<GetResult> {
      const full = pathFor(key);
      try {
        const body = await readFile(full);
        let contentType = 'application/octet-stream';
        try {
          const meta = JSON.parse(await readFile(metaPathFor(key), 'utf8')) as {
            contentType?: string;
          };
          if (meta.contentType) contentType = meta.contentType;
        } catch {
          // Sidecar missing is not fatal; fall back to the generic type.
        }
        return { body, contentType, size: body.byteLength };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new StorageError('NOT_FOUND', `No object at ${key}`);
        }
        throw new StorageError('DRIVER_ERROR', 'Local read failed', error);
      }
    },

    async delete(key: string): Promise<void> {
      await rm(pathFor(key), { force: true });
      await rm(metaPathFor(key), { force: true });
    },

    async exists(key: string): Promise<boolean> {
      try {
        await stat(pathFor(key));
        return true;
      } catch {
        return false;
      }
    },

    /**
     * No real signing locally — the app serves these through an authorized
     * route that re-checks workspace membership, so the URL alone grants
     * nothing.
     */
    async signedUrl(signed: SignedUrlOptions): Promise<string> {
      assertSafeKey(signed.key);
      const url = new URL(`/api/files/${signed.key}`, options.appUrl);
      if (signed.downloadFilename) {
        url.searchParams.set('download', safeDisplayFilename(signed.downloadFilename));
      }
      return url.toString();
    },
  };
}
