import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServerEnv, resetServerEnvCache } from '@reklu/shared';
import { DEV_LOG_PATH, sandbox, sandboxStatus, resetSandboxCache } from '../index';
import { createE2bSandboxDriver } from '../drivers/e2b';
import { createLocalSandboxDriver } from '../drivers/local';
import { assertSafeRelativePath, isolatedEnv, resolveInside } from '../paths';
import { DEFAULT_LIMITS, SandboxError } from '../types';

describe('assertSafeRelativePath', () => {
  it('accepts ordinary project paths', () => {
    expect(assertSafeRelativePath('src/app/page.tsx')).toBe('src/app/page.tsx');
    expect(assertSafeRelativePath('./package.json')).toBe('package.json');
  });

  // Generated code chooses these paths, so traversal is the default threat.
  it.each([
    ['parent traversal', '../secrets'],
    ['deep traversal', 'src/../../../../etc/passwd'],
    ['absolute', '/etc/passwd'],
    ['embedded traversal', 'a/../../b'],
  ])('rejects %s', (_label, path) => {
    expect(() => assertSafeRelativePath(path)).toThrow(SandboxError);
  });

  it.each([
    ['git directory', '.git/config'],
    ['ssh keys', '.ssh/id_rsa'],
    ['aws credentials', '.aws/credentials'],
    ['npm auth', '.npmrc'],
    ['env file', '.env'],
    ['nested env', 'config/.env'],
  ])('rejects %s even inside the sandbox', (_label, path) => {
    expect(() => assertSafeRelativePath(path)).toThrow(/protected location/);
  });

  it('rejects control characters and backslashes', () => {
    expect(() => assertSafeRelativePath('a\u0000b')).toThrow(SandboxError);
    expect(() => assertSafeRelativePath('a\\b')).toThrow(SandboxError);
  });

  it('rejects empty and absurdly long paths', () => {
    expect(() => assertSafeRelativePath('')).toThrow(SandboxError);
    expect(() => assertSafeRelativePath('a/'.repeat(300))).toThrow(SandboxError);
  });
});

describe('resolveInside', () => {
  it('resolves a contained path', () => {
    expect(resolveInside('/tmp/sbx', 'src/index.ts')).toBe('/tmp/sbx/src/index.ts');
  });

  it('refuses to escape the root', () => {
    expect(() => resolveInside('/tmp/sbx', '../other')).toThrow(SandboxError);
  });
});

describe('isolatedEnv', () => {
  /**
   * The property that matters most in this file: generated code must never see
   * Reklu's provider keys, database URL, or encryption key.
   */
  it('does not leak the process environment', () => {
    process.env.REKLU_TEST_SECRET = 'super-secret-value';
    const env = isolatedEnv();

    expect(env.REKLU_TEST_SECRET).toBeUndefined();
    expect(Object.values(env)).not.toContain('super-secret-value');
    delete process.env.REKLU_TEST_SECRET;
  });

  it('provides only a minimal baseline', () => {
    const env = isolatedEnv();
    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBe('/tmp');
    // npm must not read or write the developer's real config.
    expect(env.NPM_CONFIG_USERCONFIG).toBe('/tmp/.npmrc');
  });

  it('merges explicitly supplied values', () => {
    expect(isolatedEnv({ PORT: '3100' }).PORT).toBe('3100');
  });
});

describe('local sandbox driver', () => {
  const roots: string[] = [];

  const makeDriver = async () => {
    const root = await mkdtemp(join(tmpdir(), 'reklu-sbx-'));
    roots.push(root);
    return {
      root,
      driver: createLocalSandboxDriver({ root, appUrl: 'http://localhost:3000' }),
    };
  };

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('declares itself non-isolated', async () => {
    const { driver } = await makeDriver();
    expect(driver.isIsolated).toBe(false);
    const handle = await driver.create('sbx_1', DEFAULT_LIMITS);
    expect(handle.isIsolated).toBe(false);
  });

  it('writes and reads files', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_2', DEFAULT_LIMITS);

    await driver.writeFiles(handle, [
      { path: 'package.json', content: '{"name":"generated"}' },
      { path: 'src/index.ts', content: 'export const answer = 42;' },
    ]);

    expect(await driver.readFile(handle, 'src/index.ts')).toContain('42');
    expect(await driver.listFiles(handle)).toEqual(['package.json', 'src/index.ts']);
  });

  it('returns undefined for a missing file', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_3', DEFAULT_LIMITS);
    expect(await driver.readFile(handle, 'nope.txt')).toBeUndefined();
  });

  it('refuses to write outside the sandbox', async () => {
    const { driver, root } = await makeDriver();
    const handle = await driver.create('sbx_4', DEFAULT_LIMITS);

    await expect(
      driver.writeFiles(handle, [{ path: '../escaped.txt', content: 'nope' }]),
    ).rejects.toThrow(SandboxError);

    // And nothing was written outside.
    await expect(readFile(join(root, 'escaped.txt'), 'utf8')).rejects.toThrow();
  });

  // A bad path mid-batch must not leave a half-written tree.
  it('validates every path before writing any', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_5', DEFAULT_LIMITS);

    await expect(
      driver.writeFiles(handle, [
        { path: 'good.txt', content: 'written?' },
        { path: '../bad.txt', content: 'nope' },
      ]),
    ).rejects.toThrow(SandboxError);

    expect(await driver.readFile(handle, 'good.txt')).toBeUndefined();
  });

  it('enforces the disk limit', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_6', { ...DEFAULT_LIMITS, diskMb: 1 });

    await expect(
      driver.writeFiles(handle, [{ path: 'big.txt', content: 'x'.repeat(2 * 1_048_576) }]),
    ).rejects.toThrow(/disk limit/);
  });

  it('excludes node_modules and .git from listings', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_7', DEFAULT_LIMITS);
    await driver.writeFiles(handle, [{ path: 'src/a.ts', content: '1' }]);

    // Create ignored directories directly, bypassing the path guard.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(handle.externalId, 'node_modules/pkg'), { recursive: true });
    await writeFile(join(handle.externalId, 'node_modules/pkg/index.js'), 'x');

    expect(await driver.listFiles(handle)).toEqual(['src/a.ts']);
  });

  it('persists preview output for startup diagnostics', async () => {
    const { driver } = await makeDriver();
    const handle = await driver.create('sbx_preview_log', DEFAULT_LIMITS);
    const preview = await driver.startPreview(handle, 43_199, {
      command: process.execPath,
      args: ['-e', "console.error('preview-startup-canary')"],
      env: {},
    });

    for (let attempt = 0; attempt < 20; attempt++) {
      const output = await driver.readFile(handle, DEV_LOG_PATH);
      if (
        output?.includes('preview-startup-canary') &&
        output.includes('REKLU_PREVIEW_EXIT_CODE=0')
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const output = await driver.readFile(handle, DEV_LOG_PATH);
    expect(output).toContain('preview-startup-canary');
    expect(output).toContain('REKLU_PREVIEW_EXIT_CODE=0');
    await preview.stop();
  });

  describe('exec', () => {
    it('runs a command and captures output', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_8', DEFAULT_LIMITS);

      const result = await driver.exec(handle, { command: 'echo', args: ['hello reklu'] });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello reklu');
    });

    it('reports a non-zero exit code', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_9', DEFAULT_LIMITS);
      expect((await driver.exec(handle, { command: 'false' })).exitCode).not.toBe(0);
    });

    /** The environment isolation property, verified through a real process. */
    it('does not expose Reklu secrets to the child process', async () => {
      process.env.REKLU_LEAK_CANARY = 'canary-should-not-appear';

      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_10', DEFAULT_LIMITS);
      const result = await driver.exec(handle, { command: 'env' });

      expect(result.stdout).not.toContain('canary-should-not-appear');
      expect(result.stdout).not.toContain('REKLU_LEAK_CANARY');
      delete process.env.REKLU_LEAK_CANARY;
    });

    it('kills a command that exceeds its timeout', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_11', DEFAULT_LIMITS);

      const result = await driver.exec(handle, {
        command: 'sleep',
        args: ['30'],
        timeoutMs: 400,
      });
      expect(result.timedOut).toBe(true);
    });

    // No shell: a filename containing shell metacharacters is an argument.
    it('does not interpret arguments through a shell', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_12', DEFAULT_LIMITS);

      const result = await driver.exec(handle, {
        command: 'echo',
        args: ['hello; echo INJECTED'],
      });
      expect(result.stdout).toContain('hello; echo INJECTED');
      expect(result.stdout).not.toMatch(/^INJECTED$/m);
    });

    it('reports a missing command rather than throwing', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_13', DEFAULT_LIMITS);
      const result = await driver.exec(handle, { command: 'no-such-binary-reklu' });
      expect(result.exitCode).toBe(127);
    });
  });

  describe('destroy', () => {
    it('removes the sandbox directory', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_14', DEFAULT_LIMITS);
      await driver.writeFiles(handle, [{ path: 'a.txt', content: 'x' }]);

      await driver.destroy(handle);
      expect(await driver.readFile(handle, 'a.txt')).toBeUndefined();
    });

    // Deleting the wrong directory is the worst thing this driver could do.
    it('refuses to delete a path outside its root', async () => {
      const { driver } = await makeDriver();
      const rogue = { ...(await driver.create('sbx_15', DEFAULT_LIMITS)), externalId: '/tmp' };
      await expect(driver.destroy(rogue)).rejects.toThrow(/outside the sandbox root/);
    });

    it('is safe to call twice', async () => {
      const { driver } = await makeDriver();
      const handle = await driver.create('sbx_16', DEFAULT_LIMITS);
      await driver.destroy(handle);
      await expect(driver.destroy(handle)).resolves.toBeUndefined();
    });
  });
});

describe('toolchain reachability', () => {
  /**
   * Regression: an early version used a fixed minimal PATH that excluded the
   * Node toolchain, so every `npm install` failed with exit 127 — the sandbox
   * was isolated to the point of being useless.
   */
  it('can run npm', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reklu-sbx-tool-'));
    try {
      const driver = createLocalSandboxDriver({ root, appUrl: 'http://localhost:3000' });
      const handle = await driver.create('sbx_tool', DEFAULT_LIMITS);
      const result = await driver.exec(handle, { command: 'npm', args: ['--version'] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Widening PATH must not have reopened the leak.
  it('still withholds Reklu secrets after widening PATH', async () => {
    process.env.REKLU_PATH_CANARY = 'must-not-leak';
    const root = await mkdtemp(join(tmpdir(), 'reklu-sbx-leak-'));
    try {
      const driver = createLocalSandboxDriver({ root, appUrl: 'http://localhost:3000' });
      const handle = await driver.create('sbx_leak', DEFAULT_LIMITS);
      const result = await driver.exec(handle, { command: 'env' });

      expect(result.stdout).not.toContain('must-not-leak');
      expect(result.stdout).not.toContain('REKLU_PATH_CANARY');
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.REKLU_PATH_CANARY;
    }
  });
});

/**
 * E2B driver.
 *
 * No E2B API key is available here, so these cover everything that does not
 * require a live microVM: driver selection, configuration reporting, isolation
 * claims, and the path guard. Actually creating a microVM, writing to it and
 * running a command in it is unverified — `pnpm verify:e2b` does that once a
 * key exists, and docs/IMPLEMENTATION_STATUS.md says so rather than implying
 * these tests prove it works.
 */
describe('e2b driver', () => {
  const key = () => randomBytes(32).toString('base64');

  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
    ({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://postgres@localhost:5432/reklu',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: key(),
      ENCRYPTION_KEY: key(),
      OPENAI_API_KEY: 'sk-test',
      ...extra,
    }) as NodeJS.ProcessEnv;

  const apply = (extra: Record<string, string> = {}): void => {
    resetServerEnvCache();
    resetSandboxCache();
    for (const name of [
      'SANDBOX_DRIVER',
      'E2B_API_KEY',
      'BUILD_ENABLED',
      'SANDBOX_DOCKER_HOST',
      'SANDBOX_PREVIEW_HOST',
      'SANDBOX_PREVIEW_DOMAIN',
      'SANDBOX_DOCKER_SAME_HOST_ACK',
      'SANDBOX_DOCKER_RUNTIME',
    ]) delete process.env[name];
    Object.assign(process.env, env(extra));
  };

  afterEach(() => {
    apply();
    resetServerEnvCache();
    resetSandboxCache();
  });

  it('declares itself isolated — the reason it exists', () => {
    apply({ E2B_API_KEY: 'e2b_test' });
    expect(createE2bSandboxDriver({ apiKey: 'e2b_test' }).isIsolated).toBe(true);
  });

  it('is selected when SANDBOX_DRIVER=e2b and a key is present', () => {
    apply({ SANDBOX_DRIVER: 'e2b', E2B_API_KEY: 'e2b_test' });
    const driver = sandbox();
    expect(driver.name).toBe('e2b');
    expect(driver.isIsolated).toBe(true);
  });

  // Missing configuration must never silently downgrade to the local driver.
  it('refuses to fall back to local when the key is missing', () => {
    apply({ SANDBOX_DRIVER: 'e2b' });
    expect(() => sandbox()).toThrow(/E2B_API_KEY/);
  });

  /**
   * The "e2b selected but no key" state is unreachable at runtime: startup
   * validation rejects the combination outright, naming the variable. That is
   * a stronger guarantee than reporting it later in the UI, so it is tested
   * where it actually holds. `sandboxStatus` keeps a branch for it as
   * defence-in-depth for callers that build an env by hand.
   */
  it('refuses to start at all when e2b is selected without a key', () => {
    resetServerEnvCache();
    expect(() => loadServerEnv(env({ SANDBOX_DRIVER: 'e2b' }))).toThrow(
      /SANDBOX_DRIVER=e2b requires E2B_API_KEY/,
    );
  });

  it('reports available and isolated once configured', () => {
    apply({ SANDBOX_DRIVER: 'e2b', E2B_API_KEY: 'e2b_test' });
    const status = sandboxStatus();
    expect(status.available).toBe(true);
    expect(status.isolated).toBe(true);
  });

  it('is unavailable when Build is switched off, whatever the driver', () => {
    apply({ SANDBOX_DRIVER: 'e2b', E2B_API_KEY: 'e2b_test', BUILD_ENABLED: 'false' });
    expect(sandboxStatus().available).toBe(false);
    expect(() => sandbox()).toThrow(/turned off/);
  });

  /*
   * The self-hosted driver. A container is a real boundary but a weaker one
   * than a microVM, so the things that make it defensible — a separate host, a
   * reachable preview name — are required rather than assumed.
   */
  it('refuses the docker driver without a preview host or domain', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'tcp://10.0.0.5:2375',
    });
    expect(() => sandbox()).toThrow(/SANDBOX_PREVIEW_DOMAIN.*SANDBOX_PREVIEW_HOST/);
  });

  /*
   * The dangerous default. A daemon on this machine means generated code runs
   * beside DATABASE_URL and ENCRYPTION_KEY, and nobody should reach that by
   * leaving a variable unset.
   */
  it('refuses a same-machine daemon unless it is acknowledged', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
      SANDBOX_PREVIEW_HOST: 'builds.example.com',
    });
    expect(() => sandbox()).toThrow(/SANDBOX_DOCKER_SAME_HOST_ACK/);
  });

  it('allows a same-machine daemon once it is acknowledged', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
      SANDBOX_PREVIEW_HOST: 'builds.example.com',
      SANDBOX_DOCKER_SAME_HOST_ACK: 'true',
    });
    expect(sandbox().name).toBe('docker');
  });

  it('runs on a separate host with no acknowledgement needed', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'tcp://10.0.0.5:2375',
      SANDBOX_PREVIEW_HOST: 'builds.example.com',
    });

    const status = sandboxStatus();
    expect(status.available).toBe(true);
    expect(status.isolated).toBe(true);
    expect(status.detail).toContain('separate host');
  });

  /* "Isolated" must not be read as "as strong as a virtual machine". */
  it('says a same-machine container is a weaker boundary', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
      SANDBOX_PREVIEW_HOST: 'builds.example.com',
      SANDBOX_DOCKER_SAME_HOST_ACK: 'true',
    });
    expect(sandboxStatus().detail).toContain('weaker boundary');
  });

  /*
   * The preview iframe is granted `allow-same-origin`, without which the framed
   * page has an opaque origin and every storage access inside it throws — which
   * stops a React app hydrating and renders a white rectangle with no error
   * anywhere the reader can see.
   *
   * That grant is safe only while the preview lives somewhere else. Combined
   * with `allow-scripts` on a same-origin document it would let generated code
   * reach the page that framed it and drop its own sandbox, so same origin is
   * refused here rather than trusted not to happen.
   */
  it('refuses a preview domain that is Reklu own host', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'tcp://10.0.0.5:2375',
      SANDBOX_PREVIEW_DOMAIN: 'reklu.app',
      APP_URL: 'https://reklu.app',
    });

    /* `apply` only sets variables; the environment is validated when it is read. */
    expect(() => sandbox()).toThrow(/own host/);
  });

  it('accepts a preview subdomain, which is a different origin', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'tcp://10.0.0.5:2375',
      SANDBOX_PREVIEW_DOMAIN: 'preview.reklu.app',
      APP_URL: 'https://reklu.app',
    });
    expect(sandboxStatus().available).toBe(true);
    expect(sandboxStatus().detail).not.toContain('requires SANDBOX_PREVIEW_HOST');
  });

  it('accepts the documented same-host reverse-proxy configuration without a preview host', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'unix:///var/run/docker.sock',
      SANDBOX_DOCKER_IMAGE: 'reklu-sandbox:latest',
      SANDBOX_DOCKER_NETWORK: 'reklu-sandbox',
      SANDBOX_PREVIEW_DOMAIN: 'preview.reklu.app',
      SANDBOX_PROXY_NETWORK: 'dokploy-network',
      SANDBOX_DOCKER_SAME_HOST_ACK: 'true',
      APP_URL: 'https://reklu.app',
    });

    expect(sandboxStatus()).toMatchObject({ driver: 'docker', available: true, isolated: true });
    expect(sandbox().name).toBe('docker');
  });

  it('names the runtime when a stronger one is configured', () => {
    apply({
      SANDBOX_DRIVER: 'docker',
      SANDBOX_DOCKER_HOST: 'tcp://10.0.0.5:2375',
      SANDBOX_PREVIEW_HOST: 'builds.example.com',
      SANDBOX_DOCKER_RUNTIME: 'runsc',
    });
    expect(sandboxStatus().detail).toContain('runsc');
  });

  it('lets production boot with an isolated driver configured', () => {
    resetServerEnvCache();
    expect(() =>
      loadServerEnv(
        env({
          NODE_ENV: 'production',
          APP_URL: 'https://reklu.app',
          SANDBOX_DRIVER: 'e2b',
          E2B_API_KEY: 'e2b_test',
          BUILD_ENABLED: 'true',
          STORAGE_LOCAL_SINGLE_NODE_ACK: 'true',
        }),
      ),
    ).not.toThrow();
  });

  /** The path guard applies identically regardless of driver. */
  it('rejects traversal before any remote call is made', () => {
    expect(() => assertSafeRelativePath('../../etc/passwd')).toThrow(SandboxError);
  });
});
