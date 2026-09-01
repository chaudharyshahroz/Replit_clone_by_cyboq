/**
 * How dependencies get installed, and why the flag is not optional.
 *
 * npm refuses an unresolvable peer tree, and a generated app produces one
 * routinely: a model pairs a current ESLint with the Next config for the major
 * version it picked, and `eslint-config-next@14` declares `eslint ^7 || ^8`.
 * Both halves are reasonable; only the pairing is not. npm stops with ERESOLVE
 * and the build reports "Dependencies failed to install", which reads as a
 * network problem and is not one.
 *
 * The flag lives in one module because it was written out at three call sites
 * and present at none of them — while the sandbox image warms its cache with
 * exactly this flag. Same package manager, same container, opposite rules.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeInstallFailure,
  describeStartupFailure,
  NPM_INSTALL_ARGS,
  NPM_INSTALL_ARGS_WITH_DEV,
} from '../install-args';

describe('install arguments', () => {
  it('accepts a peer tree npm would refuse', () => {
    expect(NPM_INSTALL_ARGS).toContain('--legacy-peer-deps');
  });

  it('keeps the dev dependencies a production build needs', () => {
    /*
     * npm omits devDependencies when NODE_ENV is production, and the compiler
     * is a devDependency — so the build would run with nothing to build it.
     */
    expect(NPM_INSTALL_ARGS_WITH_DEV).toContain('--include=dev');
    expect(NPM_INSTALL_ARGS_WITH_DEV).toContain('--legacy-peer-deps');
  });

  it('is what every install actually uses', () => {
    /*
     * The failure this replaces was three call sites drifting apart. A constant
     * nobody uses is the same bug with an extra file.
     */
    for (const file of ['generate.ts', 'preview.ts', 'publish.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const installs = source.match(/args: \[[^\]]*'install'[^\]]*\]/g) ?? [];

      expect(installs, `${file} builds an install by hand`).toEqual([]);
      expect(source).toMatch(/NPM_INSTALL_ARGS/);
    }
  });
});

/**
 * What an install failure is reported as.
 *
 * npm's output is long and the reason is rarely at the end of it. A native
 * module that will not compile prints forty lines of node-gyp before anything
 * names the package, and "Dependencies failed to install" above that tells the
 * reader only that they have forty lines to read. Each case below is one that
 * has actually happened here.
 */
describe('describing an install failure', () => {
  it('names the package that needed compiling', () => {
    const gyp = [
      'npm error code 1',
      'npm error path /home/node/app/node_modules/better-sqlite3',
      'npm error command sh -c prebuild-install || node-gyp rebuild --release',
      'npm error gyp ERR! find Python',
      'npm error gyp ERR! stack Error: Could not find any Python installation to use',
    ].join('\n');

    const described = describeInstallFailure(gyp);
    expect(described).toContain('better-sqlite3');
    expect(described).toMatch(/compiled/);
  });

  it('recognises a peer conflict', () => {
    const eresolve = 'npm error ERESOLVE could not resolve\nnpm error peer eslint@"^8.0.0"';
    expect(describeInstallFailure(eresolve)).toMatch(/disagree/);
  });

  it('recognises a registry that could not be reached', () => {
    expect(describeInstallFailure('npm error network ENOTFOUND registry.npmjs.org')).toMatch(
      /registry/,
    );
  });

  it('recognises a full disk', () => {
    expect(describeInstallFailure('npm error ENOSPC: no space left on device')).toMatch(/disk/);
  });

  it('recognises a package that does not exist', () => {
    const missing = "npm error 404 Not Found - GET https://registry.npmjs.org/nope\nnpm error 404  'nope@1.0.0' is not in this registry.";
    expect(describeInstallFailure(missing)).toMatch(/does not exist/);
  });

  it('keeps the plain message for anything it does not recognise', () => {
    /* A guess dressed as a diagnosis is worse than no diagnosis. */
    expect(describeInstallFailure('npm error something entirely new')).toBe(
      'Dependencies failed to install.',
    );
    expect(describeInstallFailure('')).toBe('Dependencies failed to install.');
  });
});

/**
 * Why nothing came up on the port.
 *
 * A dev server that never starts is the worst failure to meet: a white frame,
 * and "Bad Gateway" from the proxy if the address is opened directly. Neither
 * says which of a dozen things went wrong, and Reklu waited ninety seconds to
 * find out and then said nothing.
 */
describe('describing a preview that never started', () => {
  const app = ['package.json', 'app/page.tsx', 'app/layout.tsx', 'components/Hero.tsx'];

  it('recognises a monorepo, which Reklu cannot run', () => {
    /*
     * The dev server is started at the root of the tree. In a workspace layout
     * the application is not there — the root has a manifest and no server, so
     * nothing listens and nothing errors either.
     */
    const monorepo = [
      'package.json',
      'apps/web/package.json',
      'apps/web/src/pages/Home.tsx',
      'apps/web/src/pages/Menu.tsx',
      'apps/api/src/index.ts',
      'packages/ui/src/Button.tsx',
    ];

    expect(describeStartupFailure('', monorepo)).toMatch(/monorepo/);
  });

  it('does not call an ordinary app a monorepo', () => {
    // A single `apps/` file among many is not a workspace layout.
    expect(describeStartupFailure('', app)).not.toMatch(/monorepo/);
  });

  it('recognises a port already taken', () => {
    expect(describeStartupFailure('Error: listen EADDRINUSE :::3000', app)).toMatch(/port/);
  });

  it('recognises a missing dev script', () => {
    expect(describeStartupFailure('npm error Missing script: "dev"', app)).toMatch(/dev script/);
  });

  it('names a module that could not be found', () => {
    const log = "Error: Cannot find module 'next/navigation'";
    expect(describeStartupFailure(log, app)).toContain('next/navigation');
  });

  it('distinguishes a running server with an SWC compile failure', () => {
    const log = [
      '✓ Ready in 1477ms',
      './src/components/features/Hero.tsx',
      'Unexpected token `section`. Expected jsx identifier',
      'Caused by: Syntax Error',
      'GET / 500 in 933ms',
    ].join('\n');

    const described = describeStartupFailure(log, app);
    expect(described).toMatch(/server started/);
    expect(described).toMatch(/did not compile/);
    expect(described).not.toMatch(/never started/);
  });

  it('distinguishes a running server whose homepage throws at runtime', () => {
    const log = [
      '✓ Ready in 1477ms',
      '⨯ PrismaClientInitializationError: Environment variable not found: DATABASE_URL.',
      'GET / 500 in 933ms',
    ].join('\n');

    const described = describeStartupFailure(log, app);
    expect(described).toMatch(/server started/);
    expect(described).toMatch(/failed while rendering/);
    expect(described).not.toMatch(/never started/);
  });

  it('falls back to the log when it recognises nothing', () => {
    const described = describeStartupFailure('something unfamiliar', app);
    expect(described).toMatch(/never started/);
    expect(described).toMatch(/output is below/);
  });
});
