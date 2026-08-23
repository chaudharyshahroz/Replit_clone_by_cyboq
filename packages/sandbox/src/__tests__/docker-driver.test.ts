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
      host: 'sbx-abc123.preview.example.com',
      port: 43000,
      network: 'dokploy-network',
      certResolver: 'letsencrypt',
      entrypoint: 'websecure',
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
      host: 'x.example.com',
      port: 43000,
      network: 'dokploy-network',
      certResolver: 'letsencrypt',
      entrypoint: 'websecure',
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
   * a sandbox network is unused by definition between builds.
   */
  it('recreates the network, with the subnet the firewall rules name', async () => {
    let attempts = 0;
    dockerRequest.mockImplementation(async (_t: unknown, _m: unknown, path: unknown) => {
      if (String(path).includes('/containers/create')) {
        attempts += 1;
        if (attempts === 1) {
          throw new DockerError(404, 'network reklu-sandbox not found');
        }
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
    expect(attempts).toBe(2);
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
