import { resolve } from 'node:path';
import { loadServerEnv, logger } from '@reklu/shared';
import { createLocalSandboxDriver } from './drivers/local';
import { SandboxError, type SandboxDriver } from './types';

export * from './types';
export * from './paths';
export { createLocalSandboxDriver } from './drivers/local';

let cached: SandboxDriver | undefined;

/**
 * The configured sandbox driver.
 *
 * `docker` and `e2b` are declared in the environment schema and reserved here,
 * but **not implemented**. Rather than silently falling back to the
 * non-isolated local driver — which would turn a production misconfiguration
 * into arbitrary code execution on the app server — selecting them fails
 * loudly.
 */
export function sandbox(): SandboxDriver {
  if (cached) return cached;
  const env = loadServerEnv();

  switch (env.SANDBOX_DRIVER) {
    case 'local': {
      // loadServerEnv() already refuses production with this driver.
      const root = resolve(env.SANDBOX_ROOT);
      logger.warn(
        'Using the LOCAL sandbox driver. Generated code is NOT isolated. ' +
          'Development only.',
        { root },
      );
      cached = createLocalSandboxDriver({ root, appUrl: env.APP_URL });
      return cached;
    }

    case 'docker':
    case 'e2b':
      throw new SandboxError(
        'NOT_CONFIGURED',
        `SANDBOX_DRIVER=${env.SANDBOX_DRIVER} is reserved but not implemented yet. ` +
          'Reklu will not fall back to the non-isolated local driver, because that ' +
          'would run untrusted generated code on the application server. ' +
          'See docs/BUILD_ARCHITECTURE.md.',
      );

    default:
      throw new SandboxError('NOT_CONFIGURED', `Unknown sandbox driver: ${env.SANDBOX_DRIVER}`);
  }
}

/** Whether this deployment can run generated code at all, and with what isolation. */
export function sandboxStatus(): {
  driver: string;
  available: boolean;
  isolated: boolean;
  detail: string;
} {
  const env = loadServerEnv();

  if (env.SANDBOX_DRIVER === 'local') {
    return {
      driver: 'local',
      available: true,
      isolated: false,
      detail:
        'Generated code runs as a local subprocess with no isolation. Development only.',
    };
  }

  return {
    driver: env.SANDBOX_DRIVER,
    available: false,
    isolated: true,
    detail: `The ${env.SANDBOX_DRIVER} driver is not implemented yet. Builds cannot run.`,
  };
}

/** Test helper. */
export function resetSandboxCache(): void {
  cached = undefined;
}
