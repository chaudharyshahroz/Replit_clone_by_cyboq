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
import { NPM_INSTALL_ARGS, NPM_INSTALL_ARGS_WITH_DEV } from '../install-args';

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
