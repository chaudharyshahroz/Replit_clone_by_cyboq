/**
 * The `@/` alias.
 *
 * A generated tree that imports `@/components/Header` and ships a tsconfig
 * without a matching mapping looks complete and does not compile. The reader
 * sees a white frame, then "Module not found" — a failure with no visible
 * connection to the file that caused it.
 */
import { describe, expect, it } from 'vitest';
import { aliasTargetFor, parseTsconfig, repairAliasPaths } from '../repair-imports';
import type { GeneratedFile } from '../parse';

const file = (path: string, content = ''): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('json') ? 'json' : 'tsx',
});

const layout = file('app/layout.tsx', 'import Header from "@/components/Header";');

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

  it('does nothing when there is no tsconfig to repair', () => {
    const files = [layout, file('components/Header.tsx')];
    expect(repairAliasPaths(files)).toEqual(files);
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
