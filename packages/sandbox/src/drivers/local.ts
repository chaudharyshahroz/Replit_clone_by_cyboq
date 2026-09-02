/**
 * Local subprocess driver — **development only**.
 *
 * This is honest about what it is: a child process in a scratch directory. It
 * enforces path containment, withholds Reklu's environment, caps output and
 * kills on timeout — but a determined process can still read the developer's
 * filesystem and reach the network. It is a convenience, not a security
 * boundary, and `isIsolated` is `false` so every surface can say so.
 *
 * `loadServerEnv()` refuses to start production with SANDBOX_DRIVER=local, so
 * this cannot reach a deployment.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { dirname as pathDirname } from 'node:path';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { logger } from '@reklu/shared';
import { isolatedEnv, resolveInside } from '../paths';
import { DEV_LOG_PATH } from '../preview-runtime';
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

/** Directories never walked when listing a project's files. */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', '.turbo']);

export interface LocalDriverOptions {
  /** Root under which every sandbox gets its own directory. */
  readonly root: string;
  /** Origin used to build preview URLs. */
  readonly appUrl: string;
}

export function createLocalSandboxDriver(options: LocalDriverOptions): SandboxDriver {
  const rootFor = (sandboxId: string): string => join(options.root, sandboxId);

  // The directory holding the running node binary — and therefore npm. Under a
  // version manager this is not on the default PATH, so it must be added
  // explicitly or every install fails with "command not found".
  const toolchainDir = pathDirname(process.execPath);
  const childEnv = (extra: Readonly<Record<string, string>> = {}) =>
    isolatedEnv(extra, { extraPathEntries: [toolchainDir] });

  return {
    name: 'local',
    // The whole point of this flag: nothing downstream may assume isolation.
    isIsolated: false,
    isConfigured: () => true,

    async create(sandboxId: string, limits: SandboxLimits): Promise<SandboxHandle> {
      const path = rootFor(sandboxId);
      await mkdir(path, { recursive: true });

      logger.warn('Created a NON-ISOLATED local sandbox', { sandboxId, path });

      return {
        id: sandboxId,
        driver: 'local',
        externalId: path,
        limits,
        isIsolated: false,
      };
    },

    async writeFiles(handle: SandboxHandle, files: readonly WriteFile[]): Promise<void> {
      // Validate every path before writing any of them, so a bad path in the
      // middle of a batch cannot leave a half-written tree.
      const resolved = files.map((file) => ({
        full: resolveInside(handle.externalId, file.path),
        content: file.content,
      }));

      let totalBytes = 0;
      for (const file of resolved) totalBytes += Buffer.byteLength(file.content);
      if (totalBytes > handle.limits.diskMb * 1_048_576) {
        throw new SandboxError('LIMIT_EXCEEDED', 'Generated files exceed the disk limit');
      }

      for (const file of resolved) {
        await mkdir(dirname(file.full), { recursive: true });
        await writeFile(file.full, file.content, 'utf8');
      }
    },

    async readFile(handle: SandboxHandle, path: string): Promise<string | undefined> {
      try {
        return await readFile(resolveInside(handle.externalId, path), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },

    async listFiles(handle: SandboxHandle): Promise<readonly string[]> {
      const results: string[] = [];

      const walk = async (directory: string): Promise<void> => {
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            await walk(join(directory, entry.name));
          } else if (entry.isFile()) {
            results.push(relative(handle.externalId, join(directory, entry.name)));
          }
        }
      };

      await walk(handle.externalId);
      return results.sort();
    },

    async exec(handle: SandboxHandle, execOptions: ExecOptions): Promise<ExecResult> {
      const cwd = execOptions.cwd
        ? resolveInside(handle.externalId, execOptions.cwd)
        : handle.externalId;

      const timeoutMs = execOptions.timeoutMs ?? handle.limits.timeoutMs;
      const started = Date.now();

      return new Promise<ExecResult>((resolveResult) => {
        const child = spawn(execOptions.command, [...(execOptions.args ?? [])], {
          cwd,
          // Reklu's own environment is withheld — see isolatedEnv.
          env: childEnv(execOptions.env),
          // No shell: arguments are passed as an array, so a filename
          // containing `; rm -rf /` is an argument, not a command.
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'] as const,
        });

        let stdout = '';
        let stderr = '';
        let bytes = 0;
        let truncated = false;
        let timedOut = false;

        const capture = (chunk: Buffer, target: 'out' | 'err'): void => {
          if (bytes >= handle.limits.maxOutputBytes) {
            truncated = true;
            return;
          }
          const text = chunk.toString('utf8');
          bytes += chunk.byteLength;
          if (target === 'out') stdout += text;
          else stderr += text;
        };

        child.stdout.on('data', (chunk: Buffer) => capture(chunk, 'out'));
        child.stderr.on('data', (chunk: Buffer) => capture(chunk, 'err'));

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs);

        child.on('error', (error) => {
          clearTimeout(timer);
          resolveResult({
            exitCode: 127,
            stdout,
            stderr: `${stderr}\n${error.message}`,
            durationMs: Date.now() - started,
            timedOut,
            truncated,
          });
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolveResult({
            exitCode: code ?? (timedOut ? 124 : 1),
            stdout,
            stderr,
            durationMs: Date.now() - started,
            timedOut,
            truncated,
          });
        });
      });
    },

    async startPreview(
      handle: SandboxHandle,
      port: number,
      command?: PreviewCommand,
    ): Promise<PreviewHandle> {
      /*
       * The caller's command when it has read the manifest, and the old
       * hard-coded guess when it has not. `npm run dev -- --port` is wrong for
       * Expo and for anything whose dev script does not forward flags, which is
       * why the decision moved out of here.
       */
      const spec = command ?? {
        command: 'npm',
        args: ['run', 'dev', '--', '--port', String(port)],
        env: { PORT: String(port) },
      };

      const child = spawn(spec.command, [...spec.args], {
        cwd: handle.externalId,
        env: childEnv({ ...spec.env, PORT: String(port) }),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
        detached: true,
      });

      /*
       * Always consume both pipes and persist them where the build package
       * reads preview diagnostics. Leaving these streams unread has two bad
       * outcomes: the Console has no explanation for a failed startup, and a
       * chatty compiler eventually fills the OS pipe and blocks the dev server.
       */
      const log = createWriteStream(resolveInside(handle.externalId, DEV_LOG_PATH), {
        flags: 'w',
      });
      log.on('error', (error) => {
        logger.debug('Could not persist local preview output', {
          sandboxId: handle.id,
          error,
        });
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.once('close', () => log.end());
      child.once('error', (error) => {
        log.write(`\nPreview process failed to start: ${error.message}\n`);
        log.end();
      });

      child.unref();

      return {
        // Served from a separate port, never Reklu's origin: same-origin would
        // give generated code access to the session cookie.
        url: `http://localhost:${port}`,
        port,
        async stop() {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        },
      };
    },

    async destroy(handle: SandboxHandle): Promise<void> {
      // Re-check containment before a recursive delete. Deleting the wrong
      // directory is the most damaging thing this driver could do.
      const target = handle.externalId;
      const contained = target.startsWith(options.root) && target.length > options.root.length;
      if (!contained) {
        throw new SandboxError(
          'UNSAFE_PATH',
          `Refusing to delete a path outside the sandbox root: ${target}`,
        );
      }
      try {
        await stat(target);
      } catch {
        return;
      }
      await rm(target, { recursive: true, force: true });
    },
  };
}
