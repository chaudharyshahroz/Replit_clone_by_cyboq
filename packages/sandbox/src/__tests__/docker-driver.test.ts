/**
 * The self-hosted sandbox.
 *
 * A container shares the host kernel, so the boundary is only as good as the
 * flags it is created with — and every one of those flags is invisible at
 * runtime. A container created without `CapDrop` still runs the build, still
 * serves the preview, and still looks exactly like a working sandbox. The only
 * place the difference shows up is in an incident.
 *
 * So the create call is asserted field by field. These are not style
 * preferences; each one is a way out of the container if it goes missing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dockerRequest = vi.hoisted(() => vi.fn());
vi.mock('../docker-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../docker-api')>();
  return { ...actual, dockerRequest };
});

import { readFile } from 'node:fs/promises';
import { createDockerSandboxDriver } from '../drivers/docker';
import { demultiplex, parseDockerHost } from '../docker-api';
import { createDockerSandboxDriver as makeDriver, previewSubdomain, previewUrl, proxyLabels } from '../drivers/docker';
import { DEFAULT_LIMITS } from '../types';
import { DockerError } from '../docker-api';

const driver = createDockerSandboxDriver({
  host: 'tcp://10.0.0.5:2375',
  image: 'node:22-bookworm-slim',
  network: 'reklu-sandbox',
  previewHost: 'builds.example.com',
});

/** The JSON body of the first container-create call. */
function createdConfig(): Record<string, any> {
  const call = dockerRequest.mock.calls.find(
    (args) => String(args[2]).includes('/containers/create'),
  );
  return (call?.[3] as { json: Record<string, any> }).json;
}

beforeEach(() => {
  dockerRequest.mockReset();
  dockerRequest.mockResolvedValue({
    status: 200,
    body: Buffer.from(JSON.stringify({ Id: 'container-1', ExitCode: 0 })),
  });
});

describe('how a sandbox container is created', () => {
  it('drops every capability', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().HostConfig.CapDrop).toEqual(['ALL']);
  });

  /* Without this, a setuid binary in the image is a way back to root. */
  it('forbids gaining new privileges', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().HostConfig.SecurityOpt).toContain('no-new-privileges');
  });

  /* Dropped capabilities still leave root writing wherever it has a mount. */
  it('runs as a non-root user', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().User).toBe('1000:1000');
    expect(createdConfig().User).not.toMatch(/^0[:$]/);
  });

  /*
   * Docker creates a missing WorkingDir owned by root. Pointing it at the build
   * directory gave a container that could see its own working directory and not
   * write to it — npm install failing with EACCES on a path that exists.
   */
  it('works from a directory the build user already owns', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().WorkingDir).toBe('/home/node');
  });

  it('creates the build directory as the build user, not as root', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);

    const mkdirCall = dockerRequest.mock.calls.find((args) =>
      String(JSON.stringify(args[3] ?? null)).includes('mkdir'),
    );
    const json = (mkdirCall?.[3] as { json: Record<string, any> }).json;

    expect(json.Cmd).toEqual(['mkdir', '-p', '/home/node/app']);
    expect(json.User).toBe('1000:1000');
  });

  /*
   * With no streams attached, Docker returns from `/exec/start` as soon as the
   * process is launched — so an awaited call that reads like "do this, then
   * continue" does not wait. The file upload raced the mkdir it depended on and
   * arrived at a directory that did not exist yet.
   */
  it('waits for the directory to exist before anything writes to it', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);

    const mkdirCall = dockerRequest.mock.calls.find((args) =>
      String(JSON.stringify(args[3] ?? null)).includes('mkdir'),
    );
    const json = (mkdirCall?.[3] as { json: Record<string, any> }).json;

    expect(json.AttachStdout).toBe(true);
    expect(json.AttachStderr).toBe(true);

    // And the result is inspected rather than assumed to have worked.
    expect(
      dockerRequest.mock.calls.some((args) => /\/exec\/[^/]+\/json/.test(String(args[2]))),
    ).toBe(true);
  });

  it('fails loudly when the directory cannot be created', async () => {
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      const p = String(path);
      if (p.includes('/exec/') && p.endsWith('/json')) {
        return { status: 200, body: Buffer.from(JSON.stringify({ ExitCode: 1 })) };
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });

    await expect(driver.create('sbx_1', DEFAULT_LIMITS)).rejects.toThrow(/mkdir/);
  });

  it('caps memory, CPU and process count', async () => {
    await driver.create('sbx_1', { ...DEFAULT_LIMITS, memoryMb: 512 });
    const host = createdConfig().HostConfig;

    expect(host.Memory).toBe(512 * 1024 * 1024);
    expect(host.NanoCpus).toBeGreaterThan(0);
    expect(host.PidsLimit).toBeGreaterThan(0);
  });

  /*
   * Swap equal to memory. Left unset, the container escapes its memory limit
   * into swap and takes the host's disk with it.
   */
  it('does not let the memory limit leak into swap', async () => {
    await driver.create('sbx_1', { ...DEFAULT_LIMITS, memoryMb: 512 });
    const host = createdConfig().HostConfig;
    expect(host.MemorySwap).toBe(host.Memory);
  });

  /*
   * A named network, so the host can be given rules that permit npm and forbid
   * reaching a private address range. `bridge` would inherit whatever the host
   * happens to allow, which usually includes the database.
   */
  it('attaches to the configured network rather than the default bridge', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().HostConfig.NetworkMode).toBe('reklu-sandbox');
  });

  /* Mounting the daemon's socket would hand generated code root on the host. */
  it('never mounts anything into the container', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    const host = createdConfig().HostConfig;

    expect(host.Binds ?? []).toHaveLength(0);
    expect(JSON.stringify(createdConfig())).not.toContain('docker.sock');
  });

  it('never puts Reklu’s own environment inside the container', async () => {
    process.env.REKLU_CANARY_SECRET = 'must-not-appear';
    try {
      await driver.create('sbx_1', DEFAULT_LIMITS);
      expect(JSON.stringify(createdConfig())).not.toContain('must-not-appear');
    } finally {
      delete process.env.REKLU_CANARY_SECRET;
    }
  });

  it('uses a stronger runtime when one is configured', async () => {
    const hardened = createDockerSandboxDriver({
      host: 'tcp://10.0.0.5:2375',
      image: 'node:22-bookworm-slim',
      network: 'reklu-sandbox',
      previewHost: 'builds.example.com',
      runtime: 'runsc',
    });

    await hardened.create('sbx_1', DEFAULT_LIMITS);
    expect(createdConfig().HostConfig.Runtime).toBe('runsc');
  });

  it('reports itself as isolated, unlike the local driver', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(handle.isIsolated).toBe(true);
    expect(handle.driver).toBe('docker');
  });
});

describe('publishing the preview port', () => {
  /*
   * Docker fixes port bindings when a container is created and offers no way to
   * add one later. A preview port not published here is a server that starts,
   * listens, and is reachable by nobody — which looks exactly like generated
   * code that does not work.
   */
  it('publishes the port the preview will use', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS, { publishPort: 4310 });
    const config = createdConfig();

    expect(config.ExposedPorts).toHaveProperty('4310/tcp');
    expect(config.HostConfig.PortBindings['4310/tcp']).toEqual([
      { HostIp: '0.0.0.0', HostPort: '4310' },
    ]);
  });

  it('publishes nothing when no preview is planned', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);
    const config = createdConfig();

    expect(config.ExposedPorts).toBeUndefined();
    expect(config.HostConfig.PortBindings).toBeUndefined();
    expect(config.HostConfig.PublishAllPorts).toBe(false);
  });
});

describe('running commands', () => {
  it('passes no Reklu secrets to the child', async () => {
    process.env.REKLU_CANARY_SECRET = 'must-not-appear';
    try {
      const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
      dockerRequest.mockClear();
      await driver.exec(handle, { command: 'node', args: ['-v'] });

      const execCall = dockerRequest.mock.calls.find((args) =>
        String(args[2]).includes('/exec'),
      );
      expect(JSON.stringify(execCall?.[3])).not.toContain('must-not-appear');
    } finally {
      delete process.env.REKLU_CANARY_SECRET;
    }
  });

  /*
   * Docker honours the uid in a tar header. Files packed as root land as root,
   * visible to the build and unwritable by it — npm then fails on its own
   * node_modules, which reads as a broken generation.
   */
  it('writes files owned by the build user, not by root', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    dockerRequest.mockClear();

    await driver.writeFiles(handle, [{ path: 'package.json', content: '{}' }]);

    const putCall = dockerRequest.mock.calls.find((args) => args[1] === 'PUT');
    const archive = (putCall?.[3] as { body: Buffer }).body;

    // uid and gid sit at offsets 108 and 116 of the first header block.
    const uid = Number.parseInt(
      archive.subarray(108, 116).toString('utf8').replace(/\0.*$/, '').trim(),
      8,
    );
    const gid = Number.parseInt(
      archive.subarray(116, 124).toString('utf8').replace(/\0.*$/, '').trim(),
      8,
    );

    expect(uid).toBe(1000);
    expect(gid).toBe(1000);
  });

  it('rejects a path that escapes the working directory', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    await expect(
      driver.writeFiles(handle, [{ path: '../../etc/passwd', content: 'x' }]),
    ).rejects.toThrow();
  });
});

describe('previews', () => {
  /*
   * Served from the sandbox host, never Reklu's origin — same-origin would put
   * generated code inside the session cookie's scope.
   */
  it('points at the sandbox host, not at Reklu', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    const preview = await driver.startPreview(handle, 4310, {
      command: 'npx',
      args: ['next', 'dev'],
      env: {},
    });

    expect(preview.url).toBe('http://builds.example.com:4310');
  });

  /*
   * Detached. `exec` waits for a process to exit and a dev server never does —
   * waiting would hang the build on its final step.
   */
  it('starts the server detached rather than waiting for it', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    dockerRequest.mockClear();

    await driver.startPreview(handle, 4310, { command: 'npx', args: ['vite'], env: {} });

    const startCall = dockerRequest.mock.calls.find((args) =>
      String(args[2]).includes('/start'),
    );
    expect((startCall?.[3] as { json: { Detach: boolean } }).json.Detach).toBe(true);
  });

  it('runs the preview command group as shell syntax', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    dockerRequest.mockClear();

    await driver.startPreview(handle, 4310, { command: 'npx', args: ['vite'], env: {} });

    const createCall = dockerRequest.mock.calls.find((args) =>
      String(args[2]).includes('/containers/') && String(args[2]).endsWith('/exec'),
    );
    const cmd = (createCall?.[3] as { json: { Cmd: string[] } }).json.Cmd;

    expect(cmd.slice(0, 2)).toEqual(['sh', '-c']);
    expect(cmd[2]).toMatch(/^\{ 'npx' 'vite'; \}/);
    expect(cmd[2]).not.toMatch(/^exec\s/);
  });

  it('refuses to start a preview with no command', async () => {
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    await expect(driver.startPreview(handle, 4310)).rejects.toThrow(/command/i);
  });
});

/**
 * Reklu is served over https and shows the preview in an iframe. A plain-http
 * preview inside an https page is blocked by the browser as mixed content, and
 * blocked renders as a blank panel — no error, nothing in the console the user
 * will see, just an empty preview that looks like a failed build.
 */
describe('the preview URL', () => {
  it('defaults to http for a bare host', () => {
    expect(previewUrl('203.0.113.10', 4310)).toBe('http://203.0.113.10:4310');
  });

  it('keeps https when the host asks for it', () => {
    expect(previewUrl('https://builds.example.com', 4310)).toBe(
      'https://builds.example.com:4310',
    );
  });

  /* A host that already names a port is proxied; the container port would break it. */
  it('does not append a port to a host that already has one', () => {
    expect(previewUrl('https://builds.example.com:8443', 4310)).toBe(
      'https://builds.example.com:8443',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(previewUrl('https://builds.example.com/', 4310)).toBe(
      'https://builds.example.com:4310',
    );
  });
});

describe('talking to the daemon', () => {
  it('reads a unix socket path', () => {
    expect(parseDockerHost('unix:///var/run/docker.sock')).toEqual({
      socketPath: '/var/run/docker.sock',
      tls: false,
    });
  });

  it('reads a tcp host and port', () => {
    const endpoint = parseDockerHost('tcp://10.0.0.5:2375');
    expect(endpoint.hostname).toBe('10.0.0.5');
    expect(endpoint.port).toBe(2375);
    expect(endpoint.tls).toBe(false);
  });

  /* 2376 is Docker's TLS port; treating it as plaintext would send certs in the clear. */
  it('treats the conventional TLS port as TLS', () => {
    expect(parseDockerHost('tcp://10.0.0.5:2376').tls).toBe(true);
  });
});

describe('reading command output', () => {
  /** Frame a payload the way Docker multiplexes it. */
  const frame = (stream: 1 | 2, text: string): Buffer => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };

  /*
   * Without demultiplexing, the eight-byte headers stay embedded in the text
   * and show up as corrupted characters scattered through a build log.
   */
  it('separates stdout from stderr', () => {
    const buffer = Buffer.concat([
      frame(1, 'building...\n'),
      frame(2, 'warning: something\n'),
      frame(1, 'done\n'),
    ]);

    expect(demultiplex(buffer)).toEqual({
      stdout: 'building...\ndone\n',
      stderr: 'warning: something\n',
    });
  });

  it('keeps multi-byte characters intact across the split', () => {
    const buffer = frame(1, 'héllo 世界\n');
    expect(demultiplex(buffer).stdout).toBe('héllo 世界\n');
  });

  /* Some daemon configurations return raw output; it must not be sliced up. */
  it('passes through output that is not framed', () => {
    const raw = Buffer.from('plain output with no frames\n');
    expect(demultiplex(raw).stdout).toBe('plain output with no frames\n');
  });

  it('returns nothing for an empty stream', () => {
    expect(demultiplex(Buffer.alloc(0))).toEqual({ stdout: '', stderr: '' });
  });
});

/**
 * Previews behind the proxy.
 *
 * A preview served as address-and-port hands the server's own IP to everyone
 * who opens one, needs a port range open in the firewall, and is plain http —
 * so a browser refuses to embed it in Reklu and it can only ever be a link to
 * somewhere else. Routing it through the proxy already in front of Reklu fixes
 * all three.
 */
describe('previews served from a domain', () => {
  /*
   * Generated apps routinely set X-Frame-Options: DENY — it is standard advice
   * and the model follows it — which is correct for the app and fatal for a
   * preview: the browser refuses the frame and says only "this content is
   * blocked", with nothing to indicate the header came from the app itself.
   */
  it('lets Reklu frame the preview, and nobody else', () => {
    const labels = proxyLabels({
      sandboxId: 'sbx_abc123',
      hosts: ['x.example.com'],
      port: 43000,
      network: 'dokploy-network',
      certResolver: 'letsencrypt',
      entrypoint: 'websecure',
      frameAncestor: 'https://reklu.app',
    });

    const values = Object.entries(labels);

    // The app's own refusal is cleared...
    expect(
      values.find(([key]) => key.includes('X-Frame-Options'))?.[1],
    ).toBe('');

    // ...and replaced by something narrower: one permitted page, not none.
    const csp = values.find(([key]) => key.includes('Content-Security-Policy'))?.[1];
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain('https://reklu.app');

    // And the middleware is actually attached to the router.
    expect(values.some(([key]) => key.endsWith('.middlewares'))).toBe(true);
  });

  const proxied = makeDriver({
    host: 'unix:///var/run/docker.sock',
    image: 'node:22-bookworm-slim',
    network: 'reklu-sandbox',
    previewHost: '',
    previewDomain: 'preview.example.com',
    proxyNetwork: 'dokploy-network',
    certResolver: 'letsencrypt',
    entrypoint: 'websecure',
  });

  it('routes the hostname to the container port', () => {
    const labels = proxyLabels({
      sandboxId: 'sbx_abc123',
      hosts: ['sbx-abc123.preview.example.com'],
      port: 43000,
      network: 'dokploy-network',
      certResolver: 'letsencrypt',
      entrypoint: 'websecure',
      frameAncestor: 'https://reklu.app',
    });

    expect(labels['traefik.enable']).toBe('true');
    expect(Object.values(labels)).toContain('Host(`sbx-abc123.preview.example.com`)');
    expect(Object.values(labels)).toContain('43000');
  });

  /*
   * A container on two networks leaves the proxy to guess which address to
   * dial, and it guesses wrong about half the time.
   */
  it('names the network the proxy should reach it on', () => {
    const labels = proxyLabels({
      sandboxId: 'sbx_abc123',
      hosts: ['x.example.com'],
      port: 43000,
      network: 'dokploy-network',
      certResolver: 'letsencrypt',
      entrypoint: 'websecure',
      frameAncestor: 'https://reklu.app',
    });
    expect(labels['traefik.docker.network']).toBe('dokploy-network');
  });

  /* A predictable name would open somebody else's running application. */
  it('derives an unguessable, DNS-safe subdomain from the sandbox id', () => {
    const subdomain = previewSubdomain('sbx_02hdkik200z64xm5bj187621n');

    expect(subdomain).toMatch(/^[a-z0-9-]+$/);
    expect(subdomain).toContain('02hdkik200z64xm5bj187621n');
    expect(subdomain).not.toContain('_');
  });

  it('publishes no host port when the proxy is routing', async () => {
    await proxied.create('sbx_1', DEFAULT_LIMITS, { publishPort: 43000 });
    const config = createdConfig();

    expect(config.HostConfig.PortBindings).toBeUndefined();
    // Still exposed, so the proxy knows which port to dial.
    expect(config.ExposedPorts).toHaveProperty('43000/tcp');
  });

  it('attaches the container to the proxy network', async () => {
    await proxied.create('sbx_1', DEFAULT_LIMITS, { publishPort: 43000 });

    const connect = dockerRequest.mock.calls.find((args) =>
      String(args[2]).includes('/networks/dokploy-network/connect'),
    );
    expect(connect).toBeDefined();
  });

  it('gives back an https URL with no address and no port in it', async () => {
    const handle = await proxied.create('sbx_abc', DEFAULT_LIMITS, { publishPort: 43000 });
    const preview = await proxied.startPreview(handle, 43000, {
      command: 'npx',
      args: ['next', 'dev'],
      env: {},
    });

    expect(preview.url).toBe('https://sbx-abc.preview.example.com');
    expect(preview.url).not.toContain(':43000');
    expect(preview.url.startsWith('https://')).toBe(true);
  });

  /* Without a domain configured, nothing changes for existing deployments. */
  it('still publishes a port when no domain is configured', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS, { publishPort: 43000 });
    expect(createdConfig().HostConfig.PortBindings['43000/tcp']).toBeDefined();
    expect(createdConfig()['Labels']['traefik.enable']).toBeUndefined();
  });
});

/**
 * A missing image.
 *
 * The sandbox image was treated as something installed once and kept. It is
 * not: `docker system prune` removes any image no container is currently using,
 * and a sandbox image is unused by definition between builds. The first build
 * after a routine cleanup failed with "No such image", which reads as a broken
 * deployment rather than a missing download.
 */
describe('when the host does not have the image', () => {
  it('pulls it and creates the container anyway', async () => {
    let createAttempts = 0;

    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).includes('/containers/create')) {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new DockerError(404, 'No such image: node:22-bookworm-slim');
        }
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });

    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);

    const pull = dockerRequest.mock.calls.find((args) => String(args[2]).includes('/images/create'));
    expect(pull).toBeDefined();
    expect(String(pull?.[2])).toContain('fromImage=node');
    expect(String(pull?.[2])).toContain('tag=22-bookworm-slim');

    expect(createAttempts).toBe(2);
    expect(handle.externalId).toBe('container-1');
  });

  /*
   * `docker system prune` removes unused networks as well as unused images, and
   * a sandbox network is unattached by definition between builds.
   *
   * A missing network does not fail `containers/create` — Docker records the
   * configuration and only attaches at `start` — so this is asked for directly
   * rather than recovered from a failure. The first attempt at this fix
   * retried `create` on an error that came from `start`, and therefore did
   * nothing at all.
   */
  it('creates the network when the daemon does not have it', async () => {
    dockerRequest.mockImplementation(async (_t: unknown, method: unknown, path: unknown) => {
      if (method === 'GET' && String(path).startsWith('/networks/')) {
        throw new DockerError(404, 'network reklu-sandbox not found');
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });

    await driver.create('sbx_1', DEFAULT_LIMITS);

    const create = dockerRequest.mock.calls.find((args) =>
      String(args[2]).includes('/networks/create'),
    );
    const json = (create?.[3] as { json: Record<string, any> }).json;

    expect(json.Name).toBe('reklu-sandbox');
    // Same subnet the DROP rules are written against; a network that came back
    // wider would leave those rules silently not applying.
    expect(json.IPAM.Config[0].Subnet).toBe('172.31.0.0/16');
  });

  /* The check happens before the container is created, not after it fails. */
  it('checks the network before creating the container', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);

    const order = dockerRequest.mock.calls.map((args) => String(args[2]));
    const networkCheck = order.findIndex((path) => path.startsWith('/networks/'));
    const containerCreate = order.findIndex((path) => path.includes('/containers/create'));

    expect(networkCheck).toBeGreaterThanOrEqual(0);
    expect(networkCheck).toBeLessThan(containerCreate);
  });

  it('does not recreate a network that already exists', async () => {
    await driver.create('sbx_1', DEFAULT_LIMITS);

    expect(
      dockerRequest.mock.calls.some((args) => String(args[2]).includes('/networks/create')),
    ).toBe(false);
  });

  /* Any other refusal is a real failure and must not look like a missing image. */
  it('does not pull for a failure that is not a missing image', async () => {
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).includes('/containers/create')) {
        throw new DockerError(409, 'Conflict. The container name is already in use');
      }
      return { status: 200, body: Buffer.from('{}') };
    });

    await expect(driver.create('sbx_1', DEFAULT_LIMITS)).rejects.toThrow(/Conflict/);
    expect(
      dockerRequest.mock.calls.some((args) => String(args[2]).includes('/images/create')),
    ).toBe(false);
  });
});

/**
 * The image Reklu builds itself.
 *
 * Pulling is the wrong recovery for it and always was: it exists only on the
 * host that built it, so asking a registry for it produces "pull access denied
 * ... may require 'docker login'" — a message that is true, unhelpful, and
 * points at credentials that do not exist. A `docker system prune -a` is enough
 * to trigger it, which is why this arrives on a working deployment out of
 * nowhere.
 */
describe('when the locally built sandbox image is missing', () => {
  const local = createDockerSandboxDriver({
    host: 'tcp://10.0.0.5:2375',
    image: 'reklu-sandbox:latest',
    network: 'reklu-sandbox',
    previewHost: 'builds.example.com',
  });

  function failFirstCreate() {
    let attempts = 0;
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).includes('/containers/create')) {
        attempts += 1;
        if (attempts === 1) throw new DockerError(404, 'No such image: reklu-sandbox:latest');
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });
    return () => attempts;
  }

  it('rebuilds it on the host rather than trying to pull it', async () => {
    const attempts = failFirstCreate();

    const handle = await local.create('sbx_1', DEFAULT_LIMITS);

    const pull = dockerRequest.mock.calls.find((args) => String(args[2]).includes('/images/create'));
    expect(pull).toBeUndefined();

    const build = dockerRequest.mock.calls.find((args) => String(args[2]).startsWith('/build'));
    expect(build).toBeDefined();
    expect(String(build?.[2])).toContain('t=reklu-sandbox%3Alatest');
    // A tar context, not JSON — the daemon rejects anything else.
    expect((build?.[3] as { contentType: string }).contentType).toBe('application/x-tar');

    expect(attempts()).toBe(2);
    expect(handle.externalId).toBe('container-1');
  });

  it('sends a context containing the Dockerfile', async () => {
    failFirstCreate();
    await local.create('sbx_1', DEFAULT_LIMITS);

    const build = dockerRequest.mock.calls.find((args) => String(args[2]).startsWith('/build'));
    const context = (build?.[3] as { body: Buffer }).body.toString('utf8');

    expect(context).toContain('Dockerfile');
    expect(context).toContain('FROM node:22-bookworm-slim');
    // The warm content-addressable store is the reason the image exists at all.
    expect(context).toContain('pnpm add');
    expect(context).toContain('/home/node/.pnpm-store');
    /*
     * The label is what keeps a weekly `docker system prune` from deleting the
     * image again. Rebuilding without it would fix this build and leave the
     * next cleanup free to undo the fix.
     */
    expect(context).toContain('com.reklu.keep');
  });

  /*
   * Two copies of the same Dockerfile exist and have to agree: the one in the
   * repository, which is what a person reads and runs by hand, and the one
   * embedded here, which is what actually rebuilds — the app runs in its own
   * container with no checkout to read. Drift between them means the rebuilt
   * image is quietly not the documented one.
   */
  it('matches the Dockerfile in the repository', async () => {
    const documented = await readFile(
      new URL('../../../../docker/sandbox.Dockerfile', import.meta.url),
      'utf8',
    );

    failFirstCreate();
    await local.create('sbx_1', DEFAULT_LIMITS);
    const build = dockerRequest.mock.calls.find((args) => String(args[2]).startsWith('/build'));
    const context = (build?.[3] as { body: Buffer }).body.toString('utf8');

    /* Every instruction, ignoring comments and the blank lines between them. */
    const instructions = (text: string) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .join('\n');

    for (const line of instructions(documented).split('\n')) {
      expect(context).toContain(line);
    }
  });

  it('fails loudly when the rebuild fails', async () => {
    /*
     * `/build` answers 200 and streams its outcome, so a failed build arrives as
     * a successful request. Not reading the body would leave a missing image
     * looking like a completed rebuild.
     */
    let attempts = 0;
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).startsWith('/build')) {
        return {
          status: 200,
          body: Buffer.from('{"stream":"Step 1/6"}\n{"error":"no space left on device"}\n'),
        };
      }
      if (String(path).includes('/containers/create')) {
        attempts += 1;
        if (attempts === 1) throw new DockerError(404, 'No such image: reklu-sandbox:latest');
      }
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });

    await expect(local.create('sbx_1', DEFAULT_LIMITS)).rejects.toThrow(/no space left on device/);
  });

  it('explains the registry error instead of repeating it', async () => {
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).includes('/containers/create')) {
        throw new DockerError(
          404,
          "pull access denied for reklu-sandbox, repository does not exist or may require 'docker login'",
        );
      }
      return { status: 200, body: Buffer.from('{}') };
    });

    // The daemon's own wording sends people looking for credentials that do not
    // exist. The message has to say what is actually missing, and how to make it.
    await expect(local.create('sbx_1', DEFAULT_LIMITS)).rejects.toThrow(
      /published to no registry/,
    );
    await expect(local.create('sbx_1', DEFAULT_LIMITS)).rejects.toThrow(
      /docker build -f docker\/sandbox\.Dockerfile/,
    );
  });
});

/**
 * What the container is called on the host.
 *
 * They were created unnamed, so Docker assigned its own — `crazy_moser` sitting
 * in `docker ps` beside `reklu-app` and `pgvector`, with nothing to say which
 * of them belonged to Reklu, which build it served, or whether it was a leak.
 */
describe('naming a container', () => {
  it('names it after the sandbox, under a reklu prefix', async () => {
    await driver.create('sbx_abc123', DEFAULT_LIMITS);

    const call = dockerRequest.mock.calls.find((args) =>
      String(args[2]).includes('/containers/create'),
    );
    const path = String(call?.[2]);

    expect(path).toContain('name=reklu-sbx-abc123-');
  });

  it('gives two containers for the same sandbox different names', async () => {
    /*
     * A publish keeps the old container running until its replacement serves,
     * so two exist at once — and a name derived only from the sandbox would
     * collide with the container it is meant to replace.
     */
    await driver.create('sbx_abc123', DEFAULT_LIMITS);
    await driver.create('sbx_abc123', DEFAULT_LIMITS);

    const names = dockerRequest.mock.calls
      .filter((args) => String(args[2]).includes('/containers/create'))
      .map((args) => String(args[2]));

    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });
});

/**
 * Keeping the image current without anybody being told to.
 *
 * It was rebuilt only when missing, so a change to its definition reached a
 * host only if somebody read a release note and ran a build by hand. Adding
 * Python and a compiler to it fixed nothing anywhere until that happened —
 * which is a fix that is not deployed, and indistinguishable from one that does
 * not work.
 */
describe('keeping the sandbox image current', () => {
  /*
   * A fresh driver per test, because the record of which images have been
   * confirmed belongs to the driver — two of them can point at two different
   * daemons, and one host's answer must not satisfy the other's question.
   */
  const freshDriver = () =>
    createDockerSandboxDriver({
      host: 'tcp://10.0.0.5:2375',
      image: 'reklu-sandbox:latest',
      network: 'reklu-sandbox',
      previewHost: 'builds.example.com',
    });

  /** Answer an image inspect with the given labels, and record every call. */
  function daemonWithLabels(labels: Record<string, string> | 'missing') {
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      const route = String(path);

      if (route.includes('/images/') && route.endsWith('/json')) {
        if (labels === 'missing') throw new DockerError(404, 'no such image');
        return { status: 200, body: Buffer.from(JSON.stringify({ Config: { Labels: labels } })) };
      }
      if (route.startsWith('/build')) return { status: 200, body: Buffer.from('{"stream":"ok"}') };
      return { status: 200, body: Buffer.from(JSON.stringify({ Id: 'container-1' })) };
    });
  }

  const builds = () =>
    dockerRequest.mock.calls.filter((args) => String(args[2]).startsWith('/build'));

  it('rebuilds an image whose definition has changed', async () => {
    daemonWithLabels({ 'com.reklu.sandbox-version': 'an-older-hash' });

    await freshDriver().create('sbx_1', DEFAULT_LIMITS);

    expect(builds()).toHaveLength(1);
    /* The version travels in the image, so the next run can compare against it. */
    const context = (builds()[0]?.[3] as { body: Buffer }).body.toString('utf8');
    expect(context).toContain('com.reklu.sandbox-version');
  });

  it('builds an image that is not there at all', async () => {
    // Missing and outdated are the same problem with the same answer.
    daemonWithLabels('missing');

    await freshDriver().create('sbx_1', DEFAULT_LIMITS);
    expect(builds()).toHaveLength(1);
  });

  it('leaves a current image alone', async () => {
    /*
     * The check runs before every container, so an unnecessary rebuild here
     * would cost minutes on every preview.
     */
    daemonWithLabels('missing');
    await freshDriver().create('sbx_warm', DEFAULT_LIMITS);
    const context = (builds()[0]?.[3] as { body: Buffer }).body.toString('utf8');
    const version = /com\.reklu\.sandbox-version="([a-f0-9]+)"/.exec(context)?.[1];

    expect(version).toBeTruthy();

    dockerRequest.mockClear();
    daemonWithLabels({ 'com.reklu.sandbox-version': version! });

    await freshDriver().create('sbx_2', DEFAULT_LIMITS);
    expect(builds()).toHaveLength(0);
  });

  it('asks only once however many containers it creates', async () => {
    daemonWithLabels({ 'com.reklu.sandbox-version': 'stale' });
    const reused = freshDriver();

    await reused.create('sbx_1', DEFAULT_LIMITS);
    dockerRequest.mockClear();
    daemonWithLabels({ 'com.reklu.sandbox-version': 'stale' });
    await reused.create('sbx_2', DEFAULT_LIMITS);

    /* Already settled for this driver; a second look would be a wasted call. */
    expect(builds()).toHaveLength(0);
  });

  it('does not inspect an image it did not build', async () => {
    /* A registry image is somebody else's; its contents are not ours to check. */
    dockerRequest.mockClear();
    daemonWithLabels({ 'com.reklu.sandbox-version': 'irrelevant' });

    await driver.create('sbx_1', DEFAULT_LIMITS);

    const inspects = dockerRequest.mock.calls.filter(
      (args) => String(args[2]).includes('/images/') && String(args[2]).endsWith('/json'),
    );
    expect(inspects).toHaveLength(0);
  });
});
