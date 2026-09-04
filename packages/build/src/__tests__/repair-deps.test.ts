/**
 * Packages the code imports and the manifest forgets.
 *
 * The important tests here are the refusals. Adding whatever name appears in an
 * import means installing a name a model invented, and the registry is full of
 * typosquats waiting for exactly that — a missing dependency is a broken build,
 * an invented one is arbitrary code running in the sandbox.
 */
import { describe, expect, it } from 'vitest';
import {
  importedPackages,
  packageFor,
  repairMissingDependencies,
  repairUnavailableDependencyVersions,
} from '../repair-deps';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('json') ? 'json' : 'tsx',
});

const manifest = (body: object) => file('package.json', JSON.stringify(body));
const depsOf = (files: readonly GeneratedFile[]) =>
  JSON.parse(files.find((f) => f.path === 'package.json')!.content).dependencies ?? {};

describe('reading imports', () => {
  it('names the package, not the file inside it', () => {
    expect(packageFor('date-fns/format')).toBe('date-fns');
    expect(packageFor('@hookform/resolvers/zod')).toBe('@hookform/resolvers');
  });

  it('ignores anything that is not a package', () => {
    expect(packageFor('./Header')).toBeUndefined();
    expect(packageFor('@/components/Header')).toBeUndefined();
    expect(packageFor('node:fs')).toBeUndefined();
  });

  it('finds imports across the source files', () => {
    const found = importedPackages([
      file('components/Container.tsx', "import clsx from 'clsx';"),
      file('lib/x.ts', "const { z } = require('zod');"),
      file('README.md', "import evil from 'evil'"),
    ]);

    expect(found.has('clsx')).toBe(true);
    expect(found.has('zod')).toBe(true);
    /* Prose is not code; a package named in a readme is not a dependency. */
    expect(found.has('evil')).toBe(false);
  });
});

describe('repairing the manifest', () => {
  it('adds a known package the code imports', () => {
    const result = repairMissingDependencies([
      file('components/Container.tsx', "import clsx from 'clsx';"),
      manifest({ dependencies: { next: '14.2.5' } }),
    ]);

    expect(depsOf(result).clsx).toBeDefined();
    expect(depsOf(result).next).toBe('14.2.5');
  });

  /*
   * The refusal that matters. An unrecognised name is left to fail as a compile
   * error naming the package, which beats installing something arbitrary.
   */
  it('never adds a package it does not recognise', () => {
    const files = [
      file('lib/x.ts', "import thing from 'totally-not-a-real-package-xyz';"),
      manifest({ dependencies: {} }),
    ];

    expect(repairMissingDependencies(files)).toEqual(files);
  });

  it('leaves a package that is already there at its own version', () => {
    const result = repairMissingDependencies([
      file('lib/x.ts', "import clsx from 'clsx';"),
      manifest({ dependencies: { clsx: '1.0.0' } }),
    ]);

    expect(depsOf(result).clsx).toBe('1.0.0');
  });

  it('does not duplicate something already in devDependencies', () => {
    const files = [
      file('lib/x.ts', "import { z } from 'zod';"),
      manifest({ dependencies: {}, devDependencies: { zod: '^3.0.0' } }),
    ];

    expect(repairMissingDependencies(files)).toEqual(files);
  });

  it('changes nothing when every import is already declared', () => {
    const files = [
      file('lib/x.ts', "import clsx from 'clsx';"),
      manifest({ dependencies: { clsx: '^2.1.1' } }),
    ];

    expect(repairMissingDependencies(files)).toEqual(files);
  });

  /* A manifest that is not JSON is one to leave alone rather than rewrite. */
  it('does not touch a manifest it cannot read', () => {
    const files = [
      file('lib/x.ts', "import clsx from 'clsx';"),
      file('package.json', '{ not json'),
    ];

    expect(repairMissingDependencies(files)).toEqual(files);
  });

  it('keeps the rest of the manifest intact', () => {
    const result = repairMissingDependencies([
      file('lib/x.ts', "import clsx from 'clsx';"),
      manifest({ name: 'demo', scripts: { dev: 'next dev' }, dependencies: {} }),
    ]);

    const parsed = JSON.parse(result.find((f) => f.path === 'package.json')!.content);
    expect(parsed.name).toBe('demo');
    expect(parsed.scripts.dev).toBe('next dev');
  });
});

describe('repairing unavailable dependency versions', () => {
  it('repairs an impossible range using the installer-reported same-major release', () => {
    const result = repairUnavailableDependencyVersions(
      [manifest({ dependencies: { '@next-auth/prisma-adapter': '^1.0.25', react: '18.3.1' } })],
      'No matching version found for @next-auth/prisma-adapter@^1.0.25 while fetching it\n' +
      'The latest release of @next-auth/prisma-adapter is "1.0.7".',
    );
    expect(JSON.parse(result[0]!.content).dependencies).toEqual({
      '@next-auth/prisma-adapter': '^1.0.7', react: '18.3.1',
    });
  });

  it('does not use another package release or cross a major version', () => {
    const files = [manifest({ dependencies: { '@next-auth/prisma-adapter': '^1.0.25' } })];
    for (const reported of ['The latest release of other-package is "1.0.7".',
      'The latest release of @next-auth/prisma-adapter is "2.0.0".']) {
      expect(repairUnavailableDependencyVersions(files,
        'No matching version found for @next-auth/prisma-adapter@^1.0.25 while fetching it\n' + reported,
      )).toEqual(files);
    }
  });

  it('repairs the confirmed TypeScript version hole before a cold install', () => {
    const result = repairUnavailableDependencyVersions([
      manifest({ devDependencies: { typescript: '5.4.0' } }),
    ]);
    const parsed = JSON.parse(result[0]!.content);
    expect(parsed.devDependencies.typescript).toBe('^5.4.0');
  });

  it('uses package-manager evidence to repair another unavailable exact pin', () => {
    const result = repairUnavailableDependencyVersions(
      [manifest({ dependencies: { '@scope/tool': '2.3.0', react: '18.3.1' } })],
      'ERR_PNPM_NO_MATCHING_VERSION No matching version found for @scope/tool@2.3.0 while fetching it from https://registry.npmjs.org/',
    );
    const parsed = JSON.parse(result[0]!.content);
    expect(parsed.dependencies['@scope/tool']).toBe('^2.3.0');
    expect(parsed.dependencies.react).toBe('18.3.1');
  });

  it('does not rewrite tags, ranges, or packages not named by the installer', () => {
    const files = [manifest({ dependencies: { react: '^18.0.0', next: 'latest' } })];
    expect(repairUnavailableDependencyVersions(files, 'unrelated failure')).toEqual(files);
  });
});
