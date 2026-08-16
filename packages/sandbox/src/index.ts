import { resolve } from 'node:path';
import { loadServerEnv, logger } from '@reklu/shared';
import { createLocalSandboxDriver } from './drivers/local';
import { e2bDriverFromEnv } from './drivers/e2b';
import { SandboxError, type SandboxDriver } from './types';

export * from './types';
export * from './paths';
export { createLocalSandboxDriver } from './drivers/local';
export { createE2bSandboxDriver, e2bDriverFromEnv } from './drivers/e2b';

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

  // Checked here as well as in the UI: a disabled Build must not be reachable
  // by any path, including a stale form post or a direct server-action call.
  if (!env.BUILD_ENABLED) {
    throw new SandboxError(
      'NOT_CONFIGURED',
      'The Build workspace is turned off on this instance (BUILD_ENABLED=false).',
    );
  }

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

    case 'e2b': {
      cached = e2bDriverFromEnv();
      logger.info('Using the E2B sandbox driver. Generated code runs in an isolated microVM.');
      return cached;
    }

    case 'docker':
      throw new SandboxError(
        'NOT_CONFIGURED',
        'SANDBOX_DRIVER=docker is reserved but not implemented yet. ' +
          'Reklu will not fall back to the non-isolated local driver, because that ' +
          'would run untrusted generated code on the application server. ' +
          'Use SANDBOX_DRIVER=e2b, which is implemented. ' +
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

  if (!env.BUILD_ENABLED) {
    return {
      driver: env.SANDBOX_DRIVER,
      available: false,
      isolated: false,
      detail:
        'The Build workspace is turned off on this instance. An operator can enable it ' +
        'by setting BUILD_ENABLED=true together with an isolated sandbox — ' +
        'SANDBOX_DRIVER=e2b (with E2B_API_KEY) or SANDBOX_DRIVER=docker.',
    };
  }

  if (env.SANDBOX_DRIVER === 'local') {
    return {
      driver: 'local',
      available: true,
      isolated: false,
      detail:
        'Generated code runs as a local subprocess with no isolation. Development only.',
    };
  }

  if (env.SANDBOX_DRIVER === 'e2b') {
    // Configured is not the same as working, and the difference matters here:
    // a missing key must read as "an operator has not finished setup", never as
    // a build failure the user caused.
    const configured = Boolean(env.E2B_API_KEY);
    return {
      driver: 'e2b',
      available: configured,
      isolated: true,
      detail: configured
        ? 'Generated code runs in an isolated E2B microVM, separate from Reklu.'
        : 'SANDBOX_DRIVER=e2b requires E2B_API_KEY. Set it to enable builds.',
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
