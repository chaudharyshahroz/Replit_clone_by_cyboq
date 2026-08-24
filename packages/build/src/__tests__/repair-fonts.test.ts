/**
 * Font weights `next/font` will not accept.
 *
 * A variable range is written `100..900` in CSS and rejected by the font loader,
 * which fails the build in a file the reader did not write.
 */
import { describe, expect, it } from 'vitest';
import { repairFontWeights } from '../repair-fonts';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: 'tsx',
});

const contentOf = (files: readonly GeneratedFile[], path: string) =>
  files.find((entry) => entry.path === path)!.content;

describe('repairing weights', () => {
  it('turns a variable range into the value the loader takes', () => {
    const result = repairFontWeights([
      file(
        'app/layout.tsx',
        `import { Fraunces } from "next/font/google";\nconst f = Fraunces({ weight: "100..900" });`,
      ),
    ]);

    expect(contentOf(result, 'app/layout.tsx')).toContain('"variable"');
    expect(contentOf(result, 'app/layout.tsx')).not.toContain('100..900');
  });

  it('handles single quotes and arrays of weights', () => {
    const result = repairFontWeights([
      file('app/layout.tsx', `import "next/font/google";\nweight: ['200..800']`),
    ]);

    expect(contentOf(result, 'app/layout.tsx')).toContain("'variable'");
  });

  it('leaves discrete weights exactly as they are', () => {
    const source = `import "next/font/google";\nweight: ["400", "700"]`;
    const result = repairFontWeights([file('app/layout.tsx', source)]);
    expect(contentOf(result, 'app/layout.tsx')).toBe(source);
  });
});

describe('refusing to guess', () => {
  /* The same characters elsewhere are not a font weight. */
  it('does not touch a file that never loads a font', () => {
    const source = `const versions = ["100..900"];`;
    const files = [file('lib/x.ts', source)];
    expect(repairFontWeights(files)).toEqual(files);
  });

  it('does not touch files that are not source', () => {
    const files = [file('README.md', 'weight: "100..900" with next/font')];
    expect(repairFontWeights(files)).toEqual(files);
  });

  it('returns the same objects when nothing needs changing', () => {
    const untouched = file('app/page.tsx', 'export default () => null;');
    expect(repairFontWeights([untouched])[0]).toBe(untouched);
  });
});
