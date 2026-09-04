/**
 * The `@/` alias.
 *
 * A generated tree that imports `@/components/Header` and ships a tsconfig
 * without a matching mapping looks complete and does not compile. The reader
 * sees a white frame, then "Module not found" — a failure with no visible
 * connection to the file that caused it.
 */
import { describe, expect, it } from 'vitest';
import {
  aliasTargetFor,
  parseTsconfig,
  repairAliasPaths,
  repairLocalImportPaths,
  unresolvedLocalImports,
} from '../repair-imports';
import type { GeneratedFile } from '../parse';

const file = (path: string, content = ''): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('json') ? 'json' : 'tsx',
});

const layout = file('app/layout.tsx', 'import Header from "@/components/Header";');

it('creates a missing tsconfig for an otherwise complete aliased source tree', () => {
  const files = [file('src/app/page.tsx', 'import Hero from "@/components/Home/Hero";'),
    file('src/components/Home/Hero.tsx')];
  const repaired = repairAliasPaths(files);
  const config = JSON.parse(repaired.find((f) => f.path === 'tsconfig.json')!.content);
  expect(config.compilerOptions.paths['@/*']).toEqual(['./src/*']);
  expect(repairAliasPaths(repaired)).toEqual(repaired);
});

describe('working out where the alias points', () => {
  it('points at the root when the files are at the root', () => {
    expect(aliasTargetFor([layout, file('components/Header.tsx')])).toBe('./*');
  });

  it('points at src when the files are under src', () => {
    expect(aliasTargetFor([layout, file('src/components/Header.tsx')])).toBe('./src/*');
  });

  it('says nothing when no file uses the alias', () => {
    expect(aliasTargetFor([file('app/page.tsx', 'export default () => null;')])).toBeUndefined();
  });

  /*
   * One import of a file the model forgot to write is a missing file, not
   * evidence that the alias points somewhere else entirely.
   */
  it('is not thrown off by a single unresolved import', () => {
    const files = [
      file('app/layout.tsx', 'import A from "@/components/A"; import B from "@/components/B";'),
      file('components/A.tsx'),
    ];
    expect(aliasTargetFor(files)).toBe('./*');
  });
});

describe('repairing the config', () => {
  const tsconfig = (body: string) => file('tsconfig.json', body);

  it('adds the mapping when it is missing entirely', () => {
    const result = repairAliasPaths([
      layout,
      file('components/Header.tsx'),
      tsconfig('{"compilerOptions":{"strict":true}}'),
    ]);

    const config = parseTsconfig(result.find((f) => f.path === 'tsconfig.json')!.content)!;
    const options = config.compilerOptions as Record<string, unknown>;

    expect((options.paths as Record<string, string[]>)['@/*']).toEqual(['./*']);
    /* Without baseUrl the paths are ignored, so adding one without it is no fix. */
    expect(options.baseUrl).toBe('.');
  });

  it('corrects a mapping that points at the wrong place', () => {
    const result = repairAliasPaths([
      layout,
      file('components/Header.tsx'),
      tsconfig('{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}'),
    ]);

    const config = parseTsconfig(result.find((f) => f.path === 'tsconfig.json')!.content)!;
    expect(((config.compilerOptions as any).paths as any)['@/*']).toEqual(['./*']);
  });

  /* A project that already agrees with itself must not be reformatted. */
  it('leaves a correct config untouched, byte for byte', () => {
    const original = tsconfig('{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}');
    const files = [layout, file('components/Header.tsx'), original];

    expect(repairAliasPaths(files).find((f) => f.path === 'tsconfig.json')).toBe(original);
  });

  it('keeps the other compiler options', () => {
    const result = repairAliasPaths([
      layout,
      file('components/Header.tsx'),
      tsconfig('{"compilerOptions":{"strict":true,"jsx":"preserve"},"include":["**/*.ts"]}'),
    ]);

    const config = parseTsconfig(result.find((f) => f.path === 'tsconfig.json')!.content)!;
    expect((config.compilerOptions as any).strict).toBe(true);
    expect((config.compilerOptions as any).jsx).toBe('preserve');
    expect(config.include).toEqual(['**/*.ts']);
  });

  it('creates a root alias config when none was generated', () => {
    const files = [layout, file('components/Header.tsx')];
    const repaired = repairAliasPaths(files);
    expect(repaired.slice(0, 2)).toEqual(files);
    expect(JSON.parse(repaired[2]!.content).compilerOptions.paths['@/*']).toEqual(['./*']);
  });
});

describe('repairing invented local import paths', () => {
  it('relocates @/ui/Modal to the one matching component file', () => {
    const drawer = file(
      'src/components/cart/CartDrawer.tsx',
      "import { Modal } from '@/ui/Modal'; import { Button } from '@/ui/Button';",
    );
    const result = repairLocalImportPaths([
      drawer,
      file('src/components/ui/Modal.tsx', 'export function Modal() {}'),
      file('src/components/ui/Button.tsx', 'export function Button() {}'),
    ]);
    const content = result.find((entry) => entry.path === drawer.path)!.content;
    expect(content).toContain("from '@/components/ui/Modal'");
    expect(content).toContain("from '@/components/ui/Button'");
  });

  it('does not guess when two files share the requested basename', () => {
    const source = file('src/app/page.tsx', "import Card from '@/ui/Card';");
    const result = repairLocalImportPaths([
      source,
      file('src/components/shop/Card.tsx'),
      file('src/components/menu/Card.tsx'),
    ]);
    expect(result[0]).toBe(source);
  });
});

describe('finding files a model forgot to emit', () => {
  it('reports every unresolved alias import from a generated homepage', () => {
    const page = file(
      'src/app/page.tsx',
      [
        "import { Hero } from '@/components/sections/Hero';",
        "import { About } from '@/components/sections/About';",
      ].join('\n'),
    );

    expect(unresolvedLocalImports([page])).toEqual([
      { importer: 'src/app/page.tsx', reference: '@/components/sections/Hero' },
      { importer: 'src/app/page.tsx', reference: '@/components/sections/About' },
    ]);
  });

  it('accepts alias, relative, index, style and binary targets that exist', () => {
    const page = file(
      'src/app/page.tsx',
      [
        "import Hero from '@/components/Hero';",
        "import { data } from '../lib';",
        "import './page.css';",
        "import photo from '../../public/hero.png';",
      ].join('\n'),
    );
    const photo = {
      ...file('public/hero.png'),
      binary: {
        storageKey: 'hero',
        contentType: 'image/png',
        bytes: 10,
      },
    };

    expect(
      unresolvedLocalImports([
        page,
        file('src/components/Hero.tsx'),
        file('src/lib/index.ts'),
        file('src/app/page.css'),
        photo,
      ]),
    ).toEqual([]);
  });

  it('ignores package imports owned by dependency normalization', () => {
    expect(
      unresolvedLocalImports([
        file(
          'src/app/page.tsx',
          "import Image from 'next/image'; import { motion } from 'framer-motion';",
        ),
      ]),
    ).toEqual([]);
  });
});

describe('reading a tsconfig', () => {
  /* TypeScript permits comments and trailing commas; JSON.parse does not. */
  it('tolerates comments and trailing commas', () => {
    const parsed = parseTsconfig(`{
      // the compiler
      "compilerOptions": {
        "strict": true, /* on purpose */
      },
    }`);

    expect((parsed?.compilerOptions as any)?.strict).toBe(true);
  });

  it('returns nothing for something that is not a config', () => {
    expect(parseTsconfig('not json')).toBeUndefined();
  });

  /* A URL in a value must not be mistaken for a comment. */
  it('does not treat a url as a comment', () => {
    const parsed = parseTsconfig('{"a":"https://example.com/x"}');
    expect(parsed?.a).toBe('https://example.com/x');
  });
});
