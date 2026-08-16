import { loadServerEnv } from '@reklu/shared';
import { createLocalDriver } from './drivers/local';
import { createS3Driver } from './drivers/s3';
import type { StorageDriver } from './types';

export * from './types';
export * from './keys';
export { createLocalDriver } from './drivers/local';
export { createS3Driver } from './drivers/s3';
export * from './validation';
export { resolveLocalStorageRoot } from './root';

let cached: StorageDriver | undefined;

/** The configured driver. Selection is env-driven and validated at startup. */
export function storage(): StorageDriver {
  if (cached) return cached;
  const env = loadServerEnv();

  if (env.STORAGE_DRIVER === 's3') {
    // These are guaranteed present: loadServerEnv() rejects s3 without them.
    cached = createS3Driver({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      endpoint: env.S3_ENDPOINT,
    });
  } else {
    cached = createLocalDriver({ root: env.STORAGE_LOCAL_PATH, appUrl: env.APP_URL });
  }

  return cached;
}

/** Test helper. */
export function resetStorageCache(): void {
  cached = undefined;
}
