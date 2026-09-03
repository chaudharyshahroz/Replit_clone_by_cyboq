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
import { createHash } from 'node:crypto';
import { loadServerEnv, logger } from '@reklu/shared';
import { assertSafeRelativePath, isolatedEnv } from '../paths';
import { previewProcessCommand } from '../preview-runtime';
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
  /** Public address of the sandbox machine, for port-based previews. */
  readonly previewHost: string;
  readonly runtime?: string | undefined;
  /**
   * Serve previews from a subdomain through the reverse proxy instead of an
   * address and a port. When set, no port is published to the host at all.
   */
  readonly previewDomain?: string | undefined;
  readonly proxyNetwork?: string | undefined;
  readonly certResolver?: string | undefined;
  readonly entrypoint?: string | undefined;
  /** Reklu's own origin, the only page allowed to frame a preview. */
  readonly appOrigin?: string | undefined;
}

/**
 * The subdomain a sandbox is reached at.
 *
 * Derived from the sandbox id so it is unguessable — a predictable name would
 * let anyone who knows the scheme open somebody else's running preview. Lower
 * case and hyphens only, because a DNS label admits nothing else.
 */
export function previewSubdomain(sandboxId: string): string {
  return sandboxId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Traefik labels that route one or more hostnames to this container's port. */
export function proxyLabels(params: {
  readonly sandboxId: string;
  /**
   * Every hostname this container answers on.
   *
   * More than one for a published site: it keeps its `<slug>.<domain>` address
   * after a custom domain is added, so a link shared before the domain existed
   * does not stop working the day it does.
   */
  readonly hosts: readonly string[];
  readonly port: number;
  readonly network: string;
  readonly certResolver: string;
  readonly entrypoint: string;
  /**
   * Reklu's own origin, the only page allowed to frame this container.
   *
   * Omitted for a published site. That rule exists so a preview can be shown
   * inside Reklu despite the app's own `X-Frame-Options`; a published site is
   * somebody's real website and its framing rules are theirs to set.
   */
  readonly frameAncestor?: string | undefined;
  /** Distinguishes a published site's router from a preview's. */
  readonly kind?: 'preview' | 'site';
}): Record<string, string> {
  const router = `reklu-${params.kind ?? 'preview'}-${previewSubdomain(params.sandboxId)}`;
  const middleware = `${router}-frame`;
  const rule = params.hosts.map((host) => `Host(\`${host}\`)`).join(' || ');

  return {
    'traefik.enable': 'true',
    // Named explicitly: a container on two networks leaves the proxy to guess
    // which address to dial, and it guesses wrong about half the time.
    'traefik.docker.network': params.network,
    [`traefik.http.routers.${router}.rule`]: rule,
    [`traefik.http.routers.${router}.entrypoints`]: params.entrypoint,
    [`traefik.http.routers.${router}.tls.certresolver`]: params.certResolver,
    [`traefik.http.services.${router}.loadbalancer.server.port`]: String(params.port),

    /*
     * Let Reklu frame the preview, and nobody else.
     *
     * Generated applications routinely set `X-Frame-Options: DENY` — it is
     * standard advice and the model follows it — which is correct for the app
     * and fatal for a preview: the browser refuses the frame and shows "this
     * content is blocked", with nothing to say it came from the app's own
     * header rather than from Reklu.
     *
     * The old header is removed and replaced by `frame-ancestors` naming
     * Reklu's origin alone. That is narrower than what was there: it permits
     * one page instead of forbidding all of them, and still refuses every other
     * site on the internet.
     */
    ...(params.frameAncestor
      ? {
          [`traefik.http.middlewares.${middleware}.headers.customresponseheaders.X-Frame-Options`]:
            '',
          [`traefik.http.middlewares.${middleware}.headers.customresponseheaders.Content-Security-Policy`]:
            `frame-ancestors 'self' ${params.frameAncestor}`,
          [`traefik.http.routers.${router}.middlewares`]: middleware,
        }
      : {}),
  };
}

/**
 * Where a preview is reachable from a browser.
 *
 * The scheme is configurable because Reklu is served over https and the preview
 * is shown in an iframe: a plain-http preview inside an https page is blocked
 * by the browser as mixed content, and blocked renders as a blank panel rather
 * than an error. A host given with a scheme keeps it; one given bare defaults
 * to http, which is correct for an IP address on a private network and wrong
 * for anything embedded.
 */
export function previewUrl(host: string, port: number): string {
  if (host.startsWith('http://') || host.startsWith('https://')) {
    const base = host.replace(/\/+$/, '');
    /*
     * A host that already names a port is fronted by a proxy that routes to the
     * container itself — adding the container's port would break that routing.
     */
    return /:\d+$/.test(base) ? base : `${base}:${port}`;
  }
  return `http://${host}:${port}`;
}

/**
 * Create the container, restoring the image if the host does not have it.
 *
 * The image was treated as something an operator installs once and keeps. They
 * do not: `docker system prune -a` removes any image no container is currently
 * using, and a sandbox image is unused by definition between builds. So the
 * first build after a routine cleanup failed, and the failure reads as a broken
 * deployment rather than as a missing download.
 *
 * How it is restored depends on where it came from, and that distinction is the
 * whole of this code. A registry image is pulled. Reklu's own sandbox image is
 * *built here*, on the host, and exists in no registry — so pulling it asks
 * Docker Hub for a repository that was never published, and the daemon answers
 * "pull access denied ... may require 'docker login'". That message sent
 * everyone who read it looking for credentials to a registry that has nothing
 * to do with the problem. Nothing is missing but a local build.
 */
async function createContainer(
  target: DockerTarget,
  config: unknown,
  image: string,
  name: string,
  verified: Set<string>,
): Promise<{ Id: string }> {
  const path = `/containers/create?name=${encodeURIComponent(name)}`;

  /*
   * Checked before the container is created rather than after it fails, because
   * an out-of-date image does not fail — it runs, and produces a build that
   * breaks later for a reason the image would explain.
   */
  await ensureImageCurrent(target, image, verified);

  try {
    const response = await dockerRequest(target, 'POST', path, { json: config });
    return JSON.parse(response.body.toString('utf8')) as { Id: string };
  } catch (error) {
    /*
     * `docker system prune` removes any image no container is using, and a
     * sandbox image is unused by definition between builds — so a routine
     * cleanup broke the next build with an error that reads like a broken
     * deployment rather than a missing download.
     */
    const missingImage =
      error instanceof DockerError &&
      error.status === 404 &&
      /no such image/i.test(error.message);

    if (!missingImage) throw error;

    await restoreImage(target, image);

    const response = await dockerRequest(target, 'POST', path, { json: config });
    return JSON.parse(response.body.toString('utf8')) as { Id: string };
  }
}

/**
 * A name an operator can read on the host.
 *
 * Containers were created unnamed, so Docker assigned its own — `crazy_moser`
 * beside `reklu-app` and `pgvector` in `docker ps`. Nothing on the host said
 * which of those belonged to Reklu, which build it was serving, or whether it
 * was a leak worth removing.
 *
 * The random suffix is not decoration. A publish deliberately keeps the old
 * container running until its replacement is serving, so two containers for one
 * site exist at once — and a name derived only from the site would collide with
 * the container it is meant to replace.
 */
function containerName(sandboxId: string): string {
  const slug = sandboxId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `reklu-${slug.slice(0, 48)}-${suffix}`;
}

/**
 * Make sure the sandbox network exists.
 *
 * `docker system prune` removes any network nothing is attached to, and a
 * sandbox network is unattached by definition between builds. Asked for
 * directly rather than inferred from a failure, because the failure arrives
 * from `start` while the network is named at `create`.
 */
async function ensureNetwork(target: DockerTarget, network: string): Promise<void> {
  try {
    await dockerRequest(target, 'GET', `/networks/${encodeURIComponent(network)}`);
    return;
  } catch (error) {
    if (!(error instanceof DockerError) || error.status !== 404) throw error;
  }

  logger.info('Sandbox network is missing; creating it', { network });
  await createNetwork(target, network);
}

/**
 * Create the sandbox network.
 *
 * Recreated with the same subnet the firewall rules name, so a network that has
 * been pruned comes back constrained rather than coming back open. A rule that
 * silently stops applying is worse than one that was never written.
 */
async function createNetwork(target: DockerTarget, network: string): Promise<void> {
  try {
    await dockerRequest(target, 'POST', '/networks/create', {
      json: {
        Name: network,
        Driver: 'bridge',
        CheckDuplicate: true,
        IPAM: { Config: [{ Subnet: '172.31.0.0/16' }] },
      },
    });
  } catch (error) {
    // A race with another build creating it first is success, not failure.
    if (error instanceof DockerError && error.status === 409) return;
    throw error;
  }
}

/**
 * Run a command in a container and wait for it to actually finish.
 *
 * The streams are attached deliberately. With nothing attached, Docker has no
 * output to deliver and `/exec/start` returns as soon as the process is
 * launched — so an awaited call that reads like "do this, then continue" does
 * not wait at all. `mkdir` was called that way, and the file upload that
 * depended on it raced it: the archive arrived at a directory that did not exist
 * yet, and the failure surfaced as Docker refusing to write files.
 *
 * The exit code is checked for the same reason. A command that fails silently
 * is worse than one that fails, because the error appears somewhere else.
 */
async function runToCompletion(
  target: DockerTarget,
  containerId: string,
  cmd: readonly string[],
): Promise<void> {
  const created = await dockerRequest(target, 'POST', `/containers/${containerId}/exec`, {
    json: {
      Cmd: [...cmd],
      User: `${UID}:${GID}`,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    },
  });

  const { Id } = JSON.parse(created.body.toString('utf8')) as { Id: string };

  const output = await dockerRequest(target, 'POST', `/exec/${Id}/start`, {
    json: { Detach: false, Tty: false },
    timeoutMs: 60_000,
  });

  const inspect = await dockerRequest(target, 'GET', `/exec/${Id}/json`);
  const { ExitCode } = JSON.parse(inspect.body.toString('utf8')) as {
    ExitCode: number | null;
  };

  /*
   * A number, or nothing. Docker always reports one for a finished process, but
   * treating an absent code as a failure invents an error out of a shape we did
   * not expect — the opposite of the problem this function exists to fix.
   */
  if (typeof ExitCode === 'number' && ExitCode !== 0) {
    const { stdout, stderr } = demultiplex(output.body);
    throw new SandboxError(
      'DRIVER_ERROR',
      `${cmd.join(' ')} failed with exit ${ExitCode}: ${(stderr || stdout).slice(0, 300)}`,
    );
  }
}

/**
 * Reklu's own sandbox image, which is built rather than downloaded.
 *
 * Matched on the repository name, ignoring the tag: `reklu-sandbox`,
 * `reklu-sandbox:latest` and `reklu-sandbox:v3` are all the image this module
 * knows how to build.
 */
const BUILT_LOCALLY = 'reklu-sandbox';

/**
 * The sandbox image's definition, kept here so it can be rebuilt without one.
 *
 * Duplicated from `docker/sandbox.Dockerfile` on purpose: the app runs in its
 * own container and has no copy of the repository, so the file that documents
 * the image for a person cannot be the file used to rebuild it. Both are short,
 * and a test holds them to the same base image and the same warm-cache check.
 */
const SANDBOX_DOCKERFILE = `
FROM node:22-bookworm-slim
LABEL com.reklu.keep="true"
USER root
RUN apt-get update \\
  && apt-get install -y --no-install-recommends python3 make g++ \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g pnpm@10.34.5
USER node
ENV NPM_CONFIG_CACHE=/home/node/.npm
ENV PNPM_STORE_DIR=/home/node/.pnpm-store
USER node
WORKDIR /home/node
RUN mkdir -p /home/node/warmcache \\
  && cd /home/node/warmcache \\
  && npm init -y > /dev/null 2>&1 \\
  && pnpm add --store-dir /home/node/.pnpm-store --prefer-offline \\
       next react react-dom \\
       tailwindcss postcss autoprefixer \\
       typescript @types/node @types/react @types/react-dom \\
       zod clsx \\
  && cd /home/node \\
  && rm -rf /home/node/warmcache \\
  && test "$(du -sm /home/node/.pnpm-store | cut -f1)" -gt 20
CMD ["sleep", "infinity"]
`.trim();

function repositoryOf(image: string): string {
  const slash = image.lastIndexOf('/');
  const colon = image.lastIndexOf(':');
  /* A colon before the last slash is a registry port, not a tag. */
  return colon > slash ? image.slice(0, colon) : image;
}

/**
 * A fingerprint of the image definition, carried by the image itself.
 *
 * The image was rebuilt only when it was missing, so a change to its definition
 * reached a host only if somebody read a release note and ran a build by hand.
 * Adding Python and a compiler to it fixed nothing on any machine until that
 * happened — which is a fix that is not deployed, and indistinguishable from
 * one that does not work.
 *
 * The definition is hashed and the hash is baked in as a label. An image whose
 * label does not match what this code expects is not the image this code means,
 * and is rebuilt. Nobody has to notice anything.
 */
const SANDBOX_VERSION = createHash('sha256')
  .update(SANDBOX_DOCKERFILE)
  .digest('hex')
  .slice(0, 12);

const VERSION_LABEL = 'com.reklu.sandbox-version';

/**
 * Make sure the image on this host is the one this code describes.
 *
 * Missing and outdated are the same problem with the same answer, so they take
 * the same path — and neither is an error to report, because nothing has gone
 * wrong. An image is simply built when it needs to be.
 */
async function ensureImageCurrent(
  target: DockerTarget,
  image: string,
  /**
   * Images this driver has already confirmed, so the check costs one call
   * rather than one per container.
   *
   * Held by the driver rather than by the module: two drivers can point at two
   * different daemons, and an image verified on one says nothing about the
   * other. A module-level cache would have one host's answer silently satisfy
   * the other's question.
   */
  verified: Set<string>,
): Promise<void> {
  if (repositoryOf(image) !== BUILT_LOCALLY) return;
  if (verified.has(image)) return;

  try {
    const response = await dockerRequest(target, 'GET', `/images/${encodeURIComponent(image)}/json`);
    const inspected = JSON.parse(response.body.toString('utf8')) as {
      Config?: { Labels?: Record<string, string> };
    };

    if (inspected.Config?.Labels?.[VERSION_LABEL] === SANDBOX_VERSION) {
      verified.add(image);
      return;
    }

    logger.info('The sandbox image is out of date; rebuilding it', {
      image,
      expected: SANDBOX_VERSION,
      found: inspected.Config?.Labels?.[VERSION_LABEL] ?? 'none',
    });
  } catch (error) {
    /*
     * A 404 here is an image that does not exist yet, which is the same answer.
     * Anything else is a daemon that cannot be asked, and the create call that
     * follows will fail with a better message than this one could.
     */
    if (!(error instanceof DockerError && error.status === 404)) return;
    logger.info('The sandbox image is missing; building it', { image });
  }

  await buildSandboxImage(target, image);
  verified.add(image);
}

/**
 * Put the image back, by whichever route can actually work.
 *
 * A prune takes the image and the person who ran it has no idea a build
 * depended on it. Recovering without them is the difference between a build
 * that pauses for a few minutes and a deployment that looks broken until
 * someone SSHes in.
 */
async function restoreImage(target: DockerTarget, image: string): Promise<void> {
  if (repositoryOf(image) === BUILT_LOCALLY) {
    logger.info('The sandbox image is missing; rebuilding it on the host', { image });
    await buildSandboxImage(target, image);
    return;
  }

  logger.info('Sandbox image is missing; pulling it', { image });
  await pullImage(target, image);
}

/**
 * Rebuild the sandbox image on the host, through the daemon.
 *
 * The build context is a tar holding one file. That is the whole of it — the
 * Dockerfile has no `COPY`, everything it needs it downloads — which is what
 * makes rebuilding possible from a process that has no checkout of the
 * repository and no shell on the host.
 */
async function buildSandboxImage(target: DockerTarget, image: string): Promise<void> {
  /*
   * The version label is added here rather than written into the definition,
   * because the definition is what the version is a hash of — including it
   * would make the hash depend on itself.
   */
  const context = createTar([
    {
      path: 'Dockerfile',
      content: `${SANDBOX_DOCKERFILE}\nLABEL ${VERSION_LABEL}="${SANDBOX_VERSION}"\n`,
    },
  ]);

  const response = await dockerRequest(
    target,
    'POST',
    `/build?t=${encodeURIComponent(image)}&dockerfile=Dockerfile&rm=1&forcerm=1`,
    {
      body: context,
      contentType: 'application/x-tar',
      /*
       * Long, because this warms an npm cache by installing the whole stack
       * once. It is the same wait as the original build of the image, and it
       * happens at most once per prune.
       */
      timeoutMs: 900_000,
    },
  );

  /*
   * `/build` answers 200 and then streams its result, so a failed build arrives
   * as a successful request. The failure is a JSON line in the body, and not
   * reading it would leave a missing image looking like a completed rebuild —
   * with the real error surfacing later as something unrelated.
   */
  const output = response.body.toString('utf8');
  const failure = output
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line) as { error?: string };
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.error);

  if (failure?.error) {
    throw new Error(`The sandbox image could not be rebuilt: ${failure.error.slice(0, 300)}`);
  }

  logger.info('Rebuilt the sandbox image', { image });
}

/**
 * Say what a daemon message actually means, where its own wording misleads.
 *
 * Docker reports a missing local image as a registry problem, because a pull is
 * the only way it knows to get one: "pull access denied for reklu-sandbox,
 * repository does not exist or may require 'docker login'". Every word of that
 * is true and the conclusion it invites is wrong — there are no credentials to
 * find, because the image is built on the host and was never published. Left
 * unexplained it sends whoever reads it to a registry login page.
 */
function explain(message: string): string {
  if (/pull access denied/i.test(message) && message.includes(BUILT_LOCALLY)) {
    return (
      `the sandbox image ${BUILT_LOCALLY} is not on this host and could not be rebuilt. ` +
      'It is built on the server and published to no registry, so no login will find it — ' +
      'a `docker system prune -a` removes it. Rebuild it with: ' +
      'docker build -f docker/sandbox.Dockerfile -t reklu-sandbox:latest .'
    );
  }
  return message;
}

/** Pull an image and wait for it to finish. */
async function pullImage(target: DockerTarget, image: string): Promise<void> {
  const [name, tag = 'latest'] = image.includes(':')
    ? [image.slice(0, image.lastIndexOf(':')), image.slice(image.lastIndexOf(':') + 1)]
    : [image];

  /*
   * Generous, and deliberately so: a first pull on a small machine downloads
   * a few hundred megabytes, and failing it halfway leaves the build unable to
   * start for a reason that has nothing to do with the build.
   */
  await dockerRequest(
    target,
    'POST',
    `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
    { timeoutMs: 600_000 },
  );

  logger.info('Pulled the sandbox image', { image });
}

function wrap(stage: string, error: unknown): never {
  if (error instanceof DockerError) {
    throw new SandboxError('DRIVER_ERROR', `Docker refused ${stage}: ${explain(error.message)}`);
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

  /*
   * Which images this driver has confirmed are the ones this code describes.
   * Per driver, because two of them can point at two different daemons and an
   * image verified on one says nothing about the other.
   */
  const verifiedImages = new Set<string>();

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

      /*
       * Routed, not published. With a preview domain the proxy already in front
       * of Reklu reaches the container over the Docker network, so nothing is
       * bound on the host — no port range to open in a firewall, and the
       * server's own address never appears in a URL handed to a visitor.
       */
      const proxied = Boolean(options.previewDomain && publishPort);
      const labels: Record<string, string> = { 'app.reklu.sandbox': id };

      if (proxied && publishPort) {
        Object.assign(
          labels,
          proxyLabels({
            sandboxId: id,
            hosts: createOptions?.hosts ?? [`${previewSubdomain(id)}.${options.previewDomain}`],
            port: publishPort,
            network: options.proxyNetwork ?? 'dokploy-network',
            certResolver: options.certResolver ?? 'letsencrypt',
            entrypoint: options.entrypoint ?? 'websecure',
            ...(createOptions?.hosts ? { kind: 'site' as const } : {}),
            frameAncestor: options.appOrigin ?? '',
          }),
        );
      }

      const portBindings = publishPort && !proxied
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
        // A zero command timeout means a durable published site. Turning zero
        // into 3600 made every public link die exactly one hour after publish.
        Cmd: limits.timeoutMs === 0
          ? ['sleep', 'infinity']
          : ['sleep', String(Math.ceil(limits.timeoutMs / 1000) + 3600)],
        Env: Object.entries(isolatedEnv()).map(([key, value]) => `${key}=${value}`),
        Labels: labels,
        ...(publishPort ? { ExposedPorts: { [`${publishPort}/tcp`]: {} } } : {}),
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
          ...(portBindings.PortBindings ? { PortBindings: portBindings.PortBindings } : {}),
        },
      };

      let created: { Id: string };
      try {
        /*
         * Checked before creating, not recovered from afterwards.
         *
         * A missing network does not fail `containers/create` — Docker records
         * the configuration happily and only attaches at `start`, so the error
         * arrives from a different call than the one that named the network.
         * Reacting to it there meant retrying the wrong request, and the fix
         * for a pruned network did nothing. Asking first needs no error message
         * to be parsed at all.
         */
        await ensureNetwork(target, options.network);

        created = await createContainer(target, config, options.image, containerName(id), verifiedImages);
        await dockerRequest(target, 'POST', `/containers/${created.Id}/start`);
      } catch (error) {
        wrap('container creation', error);
      }

      /*
       * A second network, so the proxy can reach it. Connected after creation
       * because a container is created on exactly one network and the rest are
       * attached afterwards.
       */
      if (proxied) {
        try {
          await dockerRequest(
            target,
            'POST',
            `/networks/${encodeURIComponent(options.proxyNetwork ?? 'dokploy-network')}/connect`,
            { json: { Container: created.Id } },
          );
        } catch (error) {
          wrap('attaching the preview network', error);
        }
      }

      /*
       * Made by the user that will write into it. Docker's archive endpoint
       * needs the destination to exist, and anything root created here would be
       * unwritable by the build.
       */
      try {
        await runToCompletion(target, created.Id, ['mkdir', '-p', WORKDIR]);
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
        files.map((file) => ({
          path: file.path,
          content: file.content,
          ...(file.encoding ? { encoding: file.encoding } : {}),
        })),
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
          `cd ${WORKDIR} && find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' -not -path './dist/*' -not -path './.turbo/*' | sed 's|^\\./||'`,
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
              /*
               * The image's own npm cache, not a scratch directory.
               *
               * `isolatedEnv` points npm at /tmp so a local subprocess cannot
               * touch the developer's real cache. Inside a container there is no
               * such cache to protect, and pointing at /tmp discards the warm one
               * the image ships with — turning every first install into a full
               * download of packages already sitting on disk. A read-only image
               * layer cannot carry anything between builds.
               */
              Env: Object.entries(
                isolatedEnv({ NPM_CONFIG_CACHE: `${HOME}/.npm`, ...(execOptions.env ?? {}) }),
              ).map(([key, value]) => `${key}=${value}`),
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
      /*
       * Output kept, not discarded.
       *
       * The server was started detached with its streams closed, so a compile
       * error — the commonest way a generated app fails — appeared only in the
       * browser tab of whoever opened the preview. Reklu had no idea anything
       * was wrong, and the Console tab it offers for exactly this was empty.
       */
      const line = previewProcessCommand(command);

      try {
        const createResponse = await dockerRequest(
          target,
          'POST',
          `/containers/${handle.externalId}/exec`,
          {
            json: {
              /*
               * `line` is a shell command group followed by exit-status
               * persistence. Prefixing it with `exec` turns the opening `{`
               * into an argument to the exec builtin (`exec: {: not found`)
               * instead of shell syntax, so Next never starts and the log is
               * never created. Docker already detaches this exec instance;
               * the extra shell-level `exec` is unnecessary.
               */
              Cmd: ['sh', '-c', line],
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
        /*
         * The proxy's hostname when there is one, and the machine's address
         * only when there is not. The second form exposes the server's own IP
         * to everyone who opens a preview, which is why it is the fallback.
         */
        url: options.previewDomain
          ? `https://${previewSubdomain(handle.id)}.${options.previewDomain}`
          : previewUrl(options.previewHost, port),
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

  if (!env.SANDBOX_PREVIEW_HOST && !env.SANDBOX_PREVIEW_DOMAIN) {
    throw new SandboxError(
      'NOT_CONFIGURED',
      'SANDBOX_DRIVER=docker requires SANDBOX_PREVIEW_DOMAIN (previews served over https ' +
        'by the reverse proxy) or SANDBOX_PREVIEW_HOST (the public address of the sandbox ' +
        'machine, with a port range opened).',
    );
  }

  return createDockerSandboxDriver({
    host: env.SANDBOX_DOCKER_HOST,
    image: env.SANDBOX_DOCKER_IMAGE,
    network: env.SANDBOX_DOCKER_NETWORK,
    previewHost: env.SANDBOX_PREVIEW_HOST ?? '',
    runtime: env.SANDBOX_DOCKER_RUNTIME,
    previewDomain: env.SANDBOX_PREVIEW_DOMAIN,
    proxyNetwork: env.SANDBOX_PROXY_NETWORK,
    certResolver: env.SANDBOX_PROXY_CERT_RESOLVER,
    entrypoint: env.SANDBOX_PROXY_ENTRYPOINT,
    appOrigin: env.APP_URL,
  });
}
