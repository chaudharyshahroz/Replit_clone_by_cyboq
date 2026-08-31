/**
 * E2B sandbox driver — generated code runs in a managed microVM (spec §36).
 *
 * This is the first driver that provides a real security boundary. The local
 * driver runs a subprocess on the app host and says so; this one runs on
 * hardware Reklu does not control, reached only over the E2B API. Generated
 * code cannot see Reklu's process, filesystem, environment, database or
 * network, because it is not on the same machine.
 *
 * Every method reconnects by sandbox id rather than holding a live object.
 * Reklu is a multi-process deployment behind a load balancer: the request that
 * creates a sandbox is very often not the request that writes files to it, and
 * an in-memory handle would work in development and fail under a second replica.
 */
import { CommandExitError, Sandbox, TimeoutError } from 'e2b';
import { loadServerEnv, logger } from '@reklu/shared';
import { assertSafeRelativePath, isolatedEnv } from '../paths';
import {
  SandboxError,
  type ExecOptions,
  type ExecResult,
  type PreviewCommand,
  type PreviewHandle,
  type SandboxDriver,
  type SandboxHandle,
  type SandboxLimits,
  type WriteFile,
} from '../types';

/** Working directory inside the microVM. E2B's default user is `user`. */
const WORKDIR = '/home/user/app';

/** Must match the path read by the build package after a failed startup. */
const DEV_LOG_PATH = '/tmp/dev-server.log';

/** Never listed back to the UI — noise, and enormous. */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', '.turbo']);

export interface E2bDriverOptions {
  readonly apiKey: string;
  /** E2B template. `base` carries Node and a standard toolchain. */
  readonly template?: string | undefined;
}

function apiKeyOrThrow(): string {
  const env = loadServerEnv();
  if (!env.E2B_API_KEY) {
    throw new SandboxError(
      'NOT_CONFIGURED',
      'SANDBOX_DRIVER=e2b requires E2B_API_KEY. Get one at https://e2b.dev.',
    );
  }
  return env.E2B_API_KEY;
}

/** Turn any E2B failure into a SandboxError without leaking internals. */
function wrap(action: string, error: unknown): never {
  if (error instanceof TimeoutError) {
    throw new SandboxError('TIMEOUT', `Sandbox ${action} timed out.`, error);
  }
  const detail = error instanceof Error ? error.message : String(error);
  throw new SandboxError('DRIVER_ERROR', `Sandbox ${action} failed: ${detail}`, error);
}

export function createE2bSandboxDriver(options: E2bDriverOptions): SandboxDriver {
  const { apiKey } = options;

  /**
   * Reconnect to a running microVM by id.
   *
   * A sandbox that has expired is gone — E2B reclaims it after its timeout — so
   * this reports a clear terminal state rather than a transport error.
   */
  async function connect(handle: SandboxHandle): Promise<Sandbox> {
    try {
      return await Sandbox.connect(handle.externalId, { apiKey });
    } catch (error) {
      throw new SandboxError(
        'DRIVER_ERROR',
        'This sandbox is no longer running. It may have exceeded its lifetime; start the preview again.',
        error,
      );
    }
  }

  const absolute = (relative: string): string =>
    `${WORKDIR}/${assertSafeRelativePath(relative)}`;

  return {
    name: 'e2b',
    // The whole point of this driver.
    isIsolated: true,

    isConfigured(): boolean {
      return Boolean(loadServerEnv().E2B_API_KEY);
    },

    async create(sandboxId: string, limits: SandboxLimits): Promise<SandboxHandle> {
      let sandbox: Sandbox;
      try {
        sandbox = await Sandbox.create({
          apiKey,
          template: options.template,
          timeoutMs: limits.timeoutMs,
          // Correlates a microVM with a Reklu build when reading E2B's dashboard.
          metadata: { reklu_sandbox_id: sandboxId },
          /**
           * Even here, the environment is the minimal baseline rather than
           * anything of Reklu's. Isolation makes a leak survivable; it is not a
           * reason to hand over secrets.
           */
          envs: isolatedEnv() as Record<string, string>,
        });
        await sandbox.files.makeDir(WORKDIR);
      } catch (error) {
        wrap('creation', error);
      }

      logger.info('Created isolated E2B sandbox', {
        sandboxId,
        externalId: sandbox.sandboxId,
      });

      return {
        id: sandboxId,
        driver: 'e2b',
        externalId: sandbox.sandboxId,
        limits,
        isIsolated: true,
      };
    },

    async writeFiles(handle: SandboxHandle, files: readonly WriteFile[]): Promise<void> {
      if (files.length === 0) return;

      // Validate every path before writing any, so a bad path mid-batch cannot
      // leave a half-written tree.
      const entries = files.map((file) => ({
        path: absolute(file.path),
        data: file.content,
      }));

      const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
      if (totalBytes > handle.limits.diskMb * 1_048_576) {
        throw new SandboxError(
          'LIMIT_EXCEEDED',
          `Writing these files would exceed the ${handle.limits.diskMb}MB disk limit.`,
        );
      }

      const sandbox = await connect(handle);
      try {
        await sandbox.files.write(entries);
      } catch (error) {
        wrap('file write', error);
      }
    },

    async readFile(handle: SandboxHandle, path: string): Promise<string | undefined> {
      const sandbox = await connect(handle);
      try {
        return await sandbox.files.read(absolute(path));
      } catch {
        // Absent is a normal answer, not a failure.
        return undefined;
      }
    },

    async listFiles(handle: SandboxHandle): Promise<readonly string[]> {
      const sandbox = await connect(handle);
      const found: string[] = [];

      const walk = async (directory: string): Promise<void> => {
        let entries;
        try {
          entries = await sandbox.files.list(directory);
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.type === 'dir') {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            await walk(`${directory}/${entry.name}`);
          } else {
            found.push(`${directory}/${entry.name}`.slice(WORKDIR.length + 1));
          }
        }
      };

      await walk(WORKDIR);
      return found.sort();
    },

    async exec(handle: SandboxHandle, execOptions: ExecOptions): Promise<ExecResult> {
      const sandbox = await connect(handle);
      const started = Date.now();
      const timeoutMs = execOptions.timeoutMs ?? handle.limits.timeoutMs;

      // Arguments are quoted rather than interpolated: a generated filename
      // containing shell metacharacters must stay an argument.
      const command = [execOptions.command, ...(execOptions.args ?? [])]
        .map((part) => `'${part.replaceAll("'", `'\\''`)}'`)
        .join(' ');

      let result: { exitCode: number; stdout: string; stderr: string };
      let timedOut = false;

      try {
        result = await sandbox.commands.run(command, {
          cwd: execOptions.cwd ? absolute(execOptions.cwd) : WORKDIR,
          timeoutMs,
          envs: { ...isolatedEnv(execOptions.env ?? {}) } as Record<string, string>,
        });
      } catch (error) {
        if (error instanceof CommandExitError) {
          // A non-zero exit is a result the caller wants, not an exception.
          result = { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
        } else if (error instanceof TimeoutError) {
          timedOut = true;
          result = { exitCode: 124, stdout: '', stderr: 'Command timed out.' };
        } else {
          wrap('command execution', error);
        }
      }

      const cap = handle.limits.maxOutputBytes;
      const truncated =
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > cap;

      return {
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, cap),
        stderr: result.stderr.slice(0, cap),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      };
    },

    /**
     * Expose a port the generated app is listening on.
     *
     * E2B gives every sandbox port its own hostname, so the preview is served
     * from an origin that is not Reklu's. A generated app therefore cannot read
     * Reklu's cookies or reach its same-origin APIs.
     */
    async startPreview(
      handle: SandboxHandle,
      port: number,
      command?: PreviewCommand,
    ): Promise<PreviewHandle> {
      const sandbox = await connect(handle);

      /*
       * Start the application. This was missing entirely: the driver asked E2B
       * for the public hostname of a port and returned it, without anything
       * ever listening on that port. Every preview in production was a URL that
       * resolved and then refused the connection — Build looked like it worked
       * until someone clicked through.
       */
      let running: Awaited<ReturnType<typeof sandbox.commands.run>> | undefined;
      if (command) {
        /*
         * Background command handles are process-local and disappear when the
         * next request reaches another Reklu replica. Persist the output inside
         * the microVM instead: preview readiness and compiler repair reconnect
         * later and read this exact file through the sandbox driver.
         */
        const line = `${[command.command, ...command.args].join(' ')} > ${DEV_LOG_PATH} 2>&1`;
        try {
          running = await sandbox.commands.run(line, {
            cwd: WORKDIR,
            // The generated app's own configuration, never Reklu's environment.
            envs: { ...isolatedEnv(command.env) } as Record<string, string>,
            background: true,
          });
          logger.info('Started a preview server', { sandboxId: handle.id, port, line });
        } catch (error) {
          wrap('preview', error);
        }
      }

      let host: string;
      try {
        host = sandbox.getHost(port);
      } catch (error) {
        wrap('preview', error);
      }

      return {
        url: `https://${host}`,
        port,
        stop: async () => {
          /*
           * Killed explicitly. The sandbox outliving a stopped preview is
           * normal — it is reused for the next edit — so leaving the old dev
           * server running would hold the port against its replacement.
           */
          try {
            if (running && 'kill' in running) await running.kill();
          } catch (error) {
            logger.debug('Preview process already gone', { sandboxId: handle.id, error });
          }
        },
      };
    },

    async destroy(handle: SandboxHandle): Promise<void> {
      try {
        const sandbox = await Sandbox.connect(handle.externalId, { apiKey });
        await sandbox.kill();
        logger.info('Destroyed E2B sandbox', { sandboxId: handle.id });
      } catch (error) {
        // Already gone is success. E2B reclaims sandboxes on timeout, so a
        // missing one is the normal case for anything long-lived.
        logger.debug('Sandbox already gone at destroy time', {
          sandboxId: handle.id,
          error,
        });
      }
    },
  };
}

/** Constructed from the environment, for the driver selector in index.ts. */
export function e2bDriverFromEnv(): SandboxDriver {
  return createE2bSandboxDriver({ apiKey: apiKeyOrThrow() });
}
