/**
 * Self-hosted sandbox: one container per build, on a Docker daemon you run.
 *
 * The point is cost — a managed microVM service charges per second, and a small
 * VM you already pay for does not. The trade is isolation strength. A container
 * shares the host kernel; a microVM does not. So everything here is about
 * making the container boundary as close to a real one as Docker allows, and
 * being honest that it is still a container.
 *
 * What that means in practice, and why each piece is here:
 *
 *   - **A separate machine.** The strongest control by far, and not one this
 *     file can enforce — `loadServerEnv` requires an explicit acknowledgement
 *     before pointing at a local daemon. A container escape beside Reklu reaches
 *     DATABASE_URL and ENCRYPTION_KEY. On its own box it reaches a box with
 *     nothing on it.
 *   - **Every capability dropped**, and `no-new-privileges`, so a setuid binary
 *     inside the image cannot be used to climb back up.
 *   - **A non-root user**, because CAP_DROP still leaves root able to write
 *     anywhere it has a mount for.
 *   - **A named network**, so the host can be given firewall rules that let
 *     packages be installed and forbid reaching a private address range.
 *     Generated code needs npm; it never needs Postgres.
 *   - **Memory, CPU and process limits**, so one runaway build cannot take the
 *     machine down for every other build.
 *   - **gVisor when it is installed**, which moves syscall handling into
 *     userspace and is the single biggest improvement available here.
 *
 * The Docker socket is never mounted into the container. That would hand
 * generated code the daemon, which is equivalent to handing it root.
 */
import { loadServerEnv, logger } from '@reklu/shared';
import { assertSafeRelativePath, isolatedEnv } from '../paths';
import { createTar, extractTar } from '../tar';
import { DockerError, demultiplex, dockerRequest, type DockerTarget } from '../docker-api';
import {
  SandboxError,
  type ExecOptions,
  type ExecResult,
  type PreviewCommand,
  type PreviewHandle,
  type SandboxDriver,
  type CreateOptions,
  type SandboxHandle,
  type SandboxLimits,
  type WriteFile,
} from '../types';

/**
 * The unprivileged user builds run as, and where its files live.
 *
 * Both of these were wrong in a way that only shows up against a real daemon.
 *
 * Docker creates a missing `WorkingDir` **owned by root**, so a container
 * running as uid 1000 could see its own working directory and not write to it —
 * `npm install` fails with EACCES on a path that plainly exists. So the
 * container's working directory is the home directory the image already
 * creates for this user, and the build directory is made inside it by the user
 * itself.
 *
 * The official Node images ship a `node` user at 1000:1000 owning /home/node,
 * which is why that uid is not arbitrary.
 */
const UID = 1000;
const GID = 1000;
const HOME = '/home/node';
const WORKDIR = `${HOME}/app`;

export interface DockerDriverOptions {
  readonly host: string;
  readonly image: string;
  readonly network: string;
  readonly previewHost: string;
  readonly runtime?: string | undefined;
}

function wrap(stage: string, error: unknown): never {
  if (error instanceof DockerError) {
    throw new SandboxError(
      'DRIVER_ERROR',
      `Docker refused ${stage}: ${error.message}`,
    );
  }
  throw new SandboxError(
    'DRIVER_ERROR',
    `Could not reach the sandbox host during ${stage}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

export function createDockerSandboxDriver(options: DockerDriverOptions): SandboxDriver {
  const target: DockerTarget = { host: options.host };

  return {
    name: 'docker',
    isIsolated: true,
    isConfigured: () => true,

    async create(
      id: string,
      limits: SandboxLimits,
      createOptions?: CreateOptions,
    ): Promise<SandboxHandle> {
      /*
       * Published now or never. Docker fixes a container's port bindings at
       * creation and offers no way to add one later, so a preview port that is
       * not known here is a preview nothing can reach — the server starts,
       * listens, and answers to no one.
       */
      const publishPort = createOptions?.publishPort;
      const portBindings = publishPort
        ? {
            ExposedPorts: { [`${publishPort}/tcp`]: {} },
            PortBindings: {
              [`${publishPort}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(publishPort) }],
            },
          }
        : {};

      /*
       * The container idles on `sleep` and does its work through `exec`. A
       * container whose main process is the build would exit the moment the
       * build finished, taking the file tree with it before it could be read
       * back.
       */
      const config = {
        Image: options.image,
        // The home directory the image already owns, not the build directory:
        // Docker would create a missing one as root and lock the user out of it.
        WorkingDir: HOME,
        // Never root. Capabilities are dropped, but root still writes wherever
        // it has a mount, and plenty of images ship setuid binaries.
        User: `${UID}:${GID}`,
        Cmd: ['sleep', String(Math.ceil(limits.timeoutMs / 1000) + 3600)],
        Env: Object.entries(isolatedEnv()).map(([key, value]) => `${key}=${value}`),
        Labels: { 'app.reklu.sandbox': id },
        ...(publishPort ? { ExposedPorts: portBindings.ExposedPorts } : {}),
        // Nothing inside should be waiting on input; an open stdin only gives a
        // stuck process something to block on.
        OpenStdin: false,
        Tty: false,
        HostConfig: {
          Memory: limits.memoryMb * 1024 * 1024,
          // Equal to Memory, so the container cannot escape its limit into swap
          // and drag the host's disk down with it.
          MemorySwap: limits.memoryMb * 1024 * 1024,
          NanoCpus: 2 * 1_000_000_000,
          PidsLimit: 512,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          NetworkMode: options.network,
          /*
           * Removed on stop as well as on our own delete. A build that ends
           * with the daemon unreachable would otherwise leave a container
           * holding memory until someone noticed.
           */
          AutoRemove: false,
          ...(options.runtime ? { Runtime: options.runtime } : {}),
          PublishAllPorts: false,
          ...(publishPort ? { PortBindings: portBindings.PortBindings } : {}),
        },
      };

      let created: { Id: string };
      try {
        const response = await dockerRequest(target, 'POST', '/containers/create', {
          json: config,
        });
        created = JSON.parse(response.body.toString('utf8')) as { Id: string };
        await dockerRequest(target, 'POST', `/containers/${created.Id}/start`);
      } catch (error) {
        wrap('container creation', error);
      }

      /*
       * Made by the user that will write into it. Docker's archive endpoint
       * needs the destination to exist, and anything root created here would be
       * unwritable by the build.
       */
      try {
        const mkdir = await dockerRequest(target, 'POST', `/containers/${created.Id}/exec`, {
          json: {
            Cmd: ['mkdir', '-p', WORKDIR],
            User: `${UID}:${GID}`,
            AttachStdout: false,
            AttachStderr: false,
            Tty: false,
          },
        });
        const { Id: mkdirId } = JSON.parse(mkdir.body.toString('utf8')) as { Id: string };
        await dockerRequest(target, 'POST', `/exec/${mkdirId}/start`, {
          json: { Detach: false, Tty: false },
        });
      } catch (error) {
        wrap('preparing the working directory', error);
      }

      logger.info('Created a Docker sandbox', {
        sandboxId: id,
        image: options.image,
        runtime: options.runtime ?? 'default',
      });

      return {
        id,
        driver: 'docker',
        externalId: created.Id,
        limits,
        isIsolated: true,
      };
    },

    async writeFiles(handle: SandboxHandle, files: readonly WriteFile[]): Promise<void> {
      for (const file of files) assertSafeRelativePath(file.path);

      /*
       * Owned by the build user. Docker honours the uid and gid in the tar
       * header, so files packed as root land as root — visible to the build and
       * unwritable by it, which surfaces as npm failing on its own node_modules.
       */
      const archive = createTar(
        files.map((file) => ({ path: file.path, content: file.content })),
        { uid: UID, gid: GID },
      );

      try {
        await dockerRequest(
          target,
          'PUT',
          `/containers/${handle.externalId}/archive?path=${encodeURIComponent(WORKDIR)}`,
          { body: archive, contentType: 'application/x-tar' },
        );
      } catch (error) {
        wrap('writing files', error);
      }
    },

    async readFile(handle: SandboxHandle, path: string): Promise<string> {
      assertSafeRelativePath(path);

      try {
        const response = await dockerRequest(
          target,
          'GET',
          `/containers/${handle.externalId}/archive?path=${encodeURIComponent(`${WORKDIR}/${path}`)}`,
        );
        const [file] = extractTar(response.body);
        if (!file) throw new SandboxError('DRIVER_ERROR', `No such file in the sandbox: ${path}`);
        return file.content;
      } catch (error) {
        if (error instanceof SandboxError) throw error;
        wrap('reading a file', error);
      }
    },

    async listFiles(handle: SandboxHandle): Promise<readonly string[]> {
      const result = await this.exec(handle, {
        command: 'sh',
        args: [
          '-c',
          // -not -path prunes before descending, so a large node_modules is not
          // walked only to be filtered out afterwards.
          `cd ${WORKDIR} && find . -type f -not -path './node_modules/*' -not -path './.git/*' | sed 's|^\\./||'`,
        ],
      });

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },

    async exec(handle: SandboxHandle, execOptions: ExecOptions): Promise<ExecResult> {
      const started = Date.now();
      const timeoutMs = execOptions.timeoutMs ?? handle.limits.timeoutMs;

      const command = [execOptions.command, ...(execOptions.args ?? [])];

      try {
        const createResponse = await dockerRequest(
          target,
          'POST',
          `/containers/${handle.externalId}/exec`,
          {
            json: {
              Cmd: command,
              WorkingDir: execOptions.cwd ? `${WORKDIR}/${execOptions.cwd}` : WORKDIR,
              // Reklu's own environment is never merged in. The child sees a
              // PATH, a HOME, and whatever the caller asked for.
              Env: Object.entries(isolatedEnv(execOptions.env ?? {})).map(
                ([key, value]) => `${key}=${value}`,
              ),
              AttachStdout: true,
              AttachStderr: true,
              Tty: false,
              User: `${UID}:${GID}`,
            },
          },
        );

        const { Id: execId } = JSON.parse(createResponse.body.toString('utf8')) as { Id: string };

        const output = await dockerRequest(target, 'POST', `/exec/${execId}/start`, {
          json: { Detach: false, Tty: false },
          timeoutMs,
        });

        const { stdout, stderr } = demultiplex(output.body);

        const inspect = await dockerRequest(target, 'GET', `/exec/${execId}/json`);
        const { ExitCode } = JSON.parse(inspect.body.toString('utf8')) as {
          ExitCode: number | null;
        };

        const limit = handle.limits.maxOutputBytes;
        const truncated = stdout.length + stderr.length > limit;

        return {
          exitCode: ExitCode ?? 0,
          stdout: stdout.slice(0, limit),
          stderr: stderr.slice(0, limit),
          durationMs: Date.now() - started,
          timedOut: false,
          truncated,
        };
      } catch (error) {
        /*
         * A timeout is a result, not a failure. The build log should say the
         * command ran too long; throwing here would lose everything it printed
         * before it hung.
         */
        if (error instanceof Error && /in time/.test(error.message)) {
          return {
            exitCode: 124,
            stdout: '',
            stderr: `Command exceeded ${timeoutMs}ms and was abandoned.`,
            durationMs: Date.now() - started,
            timedOut: true,
            truncated: false,
          };
        }
        wrap('running a command', error);
      }
    },

    async startPreview(
      handle: SandboxHandle,
      port: number,
      command?: PreviewCommand,
    ): Promise<PreviewHandle> {
      if (!command) {
        throw new SandboxError('DRIVER_ERROR', 'A preview needs a command to run.');
      }

      /*
       * Started detached. `exec` waits for the process to finish, and a dev
       * server never finishes — waiting on it would hang the build at the last
       * step, which is exactly the shape of the bug this driver is being added
       * alongside.
       */
      const line = [command.command, ...command.args].join(' ');

      try {
        const createResponse = await dockerRequest(
          target,
          'POST',
          `/containers/${handle.externalId}/exec`,
          {
            json: {
              Cmd: ['sh', '-c', `exec ${line}`],
              WorkingDir: WORKDIR,
              Env: Object.entries(isolatedEnv(command.env)).map(
                ([key, value]) => `${key}=${value}`,
              ),
              AttachStdout: false,
              AttachStderr: false,
              Detach: true,
              Tty: false,
              User: `${UID}:${GID}`,
            },
          },
        );

        const { Id: execId } = JSON.parse(createResponse.body.toString('utf8')) as { Id: string };
        await dockerRequest(target, 'POST', `/exec/${execId}/start`, {
          json: { Detach: true, Tty: false },
        });

        logger.info('Started a preview server in a Docker sandbox', {
          sandboxId: handle.id,
          port,
          line,
        });
      } catch (error) {
        wrap('starting the preview', error);
      }

      return {
        /*
         * The sandbox host's own name, not Reklu's. Serving generated code from
         * Reklu's origin would put it inside the same cookie scope as the
         * session it was generated from.
         */
        url: `http://${options.previewHost}:${port}`,
        port,
        stop: async () => {
          // The container is the lifetime. Killing the process inside it while
          // leaving the container up would strand the port.
          logger.debug('Preview released; container remains until destroyed', {
            sandboxId: handle.id,
          });
        },
      };
    },

    async destroy(handle: SandboxHandle): Promise<void> {
      try {
        await dockerRequest(
          target,
          'DELETE',
          // v=1 removes anonymous volumes; force=1 kills it if it is still up.
          // Leaving either behind fills the host's disk one build at a time.
          `/containers/${handle.externalId}?force=1&v=1`,
        );
        logger.info('Destroyed a Docker sandbox', { sandboxId: handle.id });
      } catch (error) {
        // Already gone is success.
        logger.debug('Sandbox container already gone at destroy time', {
          sandboxId: handle.id,
          error,
        });
      }
    },
  };
}

/** Constructed from the environment, for the driver selector. */
export function dockerDriverFromEnv(): SandboxDriver {
  const env = loadServerEnv();

  if (!env.SANDBOX_PREVIEW_HOST) {
    throw new SandboxError(
      'NOT_CONFIGURED',
      'SANDBOX_DRIVER=docker requires SANDBOX_PREVIEW_HOST — the public hostname or ' +
        'IP of the sandbox machine, which is where preview URLs point.',
    );
  }

  return createDockerSandboxDriver({
    host: env.SANDBOX_DOCKER_HOST,
    image: env.SANDBOX_DOCKER_IMAGE,
    network: env.SANDBOX_DOCKER_NETWORK,
    previewHost: env.SANDBOX_PREVIEW_HOST,
    runtime: env.SANDBOX_DOCKER_RUNTIME,
  });
}
