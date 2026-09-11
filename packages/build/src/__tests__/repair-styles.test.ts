import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '../parse';
import { repairGlobalStyles, tailwindStylesProblem } from '../repair-styles';

const file = (path: string, content: string): GeneratedFile => ({ path, content, language: 'tsx' });

describe('repairGlobalStyles', () => {
  it('imports colocated global CSS from a Next root layout', () => {
    const result = repairGlobalStyles([
      file('src/app/layout.tsx', 'export default function Layout() { return <html />; }'),
      file('src/app/globals.css', '@tailwind base;'),
    ]);
    expect(result[0]!.content).toMatch(/^import '\.\/globals\.css';/);
  });

  it('keeps a client directive first and is idempotent', () => {
    const files = [
      file('app/layout.tsx', "'use client';\nexport default function Layout() { return <html />; }"),
      file('app/globals.css', 'body {}'),
    ];
    const once = repairGlobalStyles(files);
    const twice = repairGlobalStyles(once);
    expect(once[0]!.content).toMatch(/^'use client';\nimport '\.\/globals\.css';/);
    expect(twice).toEqual(once);
  });

  it('does nothing without a matching stylesheet', () => {
    const files = [file('src/app/layout.tsx', 'export default function Layout() {}')];
    expect(repairGlobalStyles(files)).toEqual(files);
  });
});

describe('Tailwind stylesheet repair', () => {
  it('adds Tailwind 3 directives when utility markup has no Tailwind entry', () => {
    const result = repairGlobalStyles([
      file('package.json', JSON.stringify({ devDependencies: { tailwindcss: '^3.4.0' } })),
      file('src/app/layout.tsx', 'export default function Layout({ children }) { return <html><body>{children}</body></html> }'),
      file('src/app/page.tsx', 'export default () => <main className="flex min-h-screen">Hello</main>'),
      file('src/app/globals.css', '@import url("https://fonts.example/font.css");\nbody { margin: 0; }'),
    ]);
    const css = result.find((entry) => entry.path === 'src/app/globals.css')!.content;

    expect(css).toContain('@tailwind base;');
    expect(css.indexOf('@import url')).toBeLessThan(css.indexOf('@tailwind base'));
    expect(tailwindStylesProblem(result)).toBeUndefined();
  });

  it('loads Tailwind 4 with its CSS import', () => {
    const result = repairGlobalStyles([
      file('package.json', JSON.stringify({ dependencies: { tailwindcss: '^4.1.0' } })),
      file('app/layout.tsx', 'export default function Layout({ children }) { return <html><body>{children}</body></html> }'),
      file('app/page.tsx', 'export default () => <main className="grid gap-8">Hello</main>'),
      file('app/globals.css', 'body { margin: 0; }'),
    ]);

    expect(result.find((entry) => entry.path === 'app/globals.css')!.content).toMatch(/^@import "tailwindcss";/);
  });

  it('rewrites the Tailwind 4 PostCSS plugin when the project uses Tailwind 3', () => {
    const result = repairGlobalStyles([
      file('package.json', JSON.stringify({ devDependencies: { tailwindcss: '^3.4.0' } })),
      file(
        'postcss.config.js',
        "module.exports = { plugins: { '@tailwindcss/postcss': {} } };",
      ),
    ]);

    const config = result.find((entry) => entry.path === 'postcss.config.js')!.content;
    expect(config).toContain("'tailwindcss'");
    expect(config).not.toContain('@tailwindcss/postcss');
  });

  it('rewrites a legacy PostCSS plugin key when the project uses Tailwind 4', () => {
    const result = repairGlobalStyles([
      file('package.json', JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0' } })),
      file('postcss.config.js', "module.exports = { plugins: { tailwindcss: {} } };"),
    ]);

    const config = result.find((entry) => entry.path === 'postcss.config.js')!.content;
    expect(config).toContain("'@tailwindcss/postcss':");
    expect(config).not.toMatch(/\btailwindcss\s*:/);
  });

  it('hoists a generated design import that was appended after CSS rules', () => {
    const files = [
      file(
        'src/app/globals.css',
        'body { margin: 0; }\n.card { display: grid; }\n@import "./reklu-design.css";\n.footer { color: black; }',
      ),
    ];

    const once = repairGlobalStyles(files);
    const css = once[0]!.content;
    expect(css).toMatch(/^@import "\.\/reklu-design\.css";/);
    expect(css.indexOf('@import')).toBeLessThan(css.indexOf('body'));
    expect(repairGlobalStyles(once)).toEqual(once);
  });

  it('keeps charset first while hoisting multiple imports', () => {
    const result = repairGlobalStyles([
      file(
        'app/globals.css',
        '@charset "UTF-8";\nbody {}\n@import url("https://fonts.example/a.css");\n@import "./theme.css";',
      ),
    ]);

    expect(result[0]!.content).toMatch(
      /^@charset "UTF-8";\n@import url\("https:\/\/fonts\.example\/a\.css"\);\n@import "\.\/theme\.css";\nbody \{\}/,
    );
  });
});

describe('an entry for the wrong Tailwind', () => {
  /**
   * A stylesheet whose directives the installed Tailwind ignores generates no
   * utilities at all, and the page arrives with none of its classes applied:
   * unstyled blue links, and an icon carrying `w-8 h-8` expanding to fill the
   * viewport because that class meant nothing.
   *
   * Checking only that *some* entry existed passed this. Worse, the pipeline
   * produces it on its own: Design V5 asks for a `@theme` block, repair-deps
   * sees `@theme` and upgrades the toolchain to Tailwind 4, and the stylesheet
   * keeps the `@tailwind` directives that version dropped.
   */
  const manifest = (tailwind: string): GeneratedFile =>
    file(
      'package.json',
      JSON.stringify({ dependencies: { next: '14.2.0' }, devDependencies: { tailwindcss: tailwind } }),
    );

  const page = file(
    'src/app/page.tsx',
    'export default function P() { return <div className="min-h-screen" />; }',
  );

  it('reports v3 directives under a v4 toolchain', () => {
    const problem = tailwindStylesProblem([
      manifest('^4.1.0'),
      page,
      file('src/app/globals.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n'),
    ]);

    expect(problem).toMatch(/Tailwind 3 @tailwind directives/);
    expect(problem).toMatch(/ignores them/);
  });

  it('reports a v4 import under a v3 toolchain', () => {
    const problem = tailwindStylesProblem([
      manifest('^3.4.1'),
      page,
      file('src/app/globals.css', '@import "tailwindcss";\n'),
    ]);

    expect(problem).toMatch(/Tailwind 4 @import/);
  });

  it('rewrites v3 directives to the v4 entry, keeping everything else', () => {
    const repaired = repairGlobalStyles([
      manifest('^4.1.0'),
      page,
      file(
        'src/app/globals.css',
        '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@theme {\n  --color-brand: #1d4ed8;\n}\n',
      ),
    ]);

    const css = repaired.find((entry) => entry.path === 'src/app/globals.css')!.content;
    expect(css).toContain('@import "tailwindcss";');
    expect(css).not.toMatch(/@tailwind\s+(?:base|components|utilities)/);
    // The design tokens are the point of the stylesheet; they must survive.
    expect(css).toContain('--color-brand: #1d4ed8');
    // One entry, not three.
    expect(css.match(/@import\s+"tailwindcss"/g)).toHaveLength(1);
  });

  it('rewrites the v4 entry back to directives under Tailwind 3', () => {
    const repaired = repairGlobalStyles([
      manifest('^3.4.1'),
      page,
      file('src/app/globals.css', '@import "tailwindcss";\n\nbody { margin: 0; }\n'),
    ]);

    const css = repaired.find((entry) => entry.path === 'src/app/globals.css')!.content;
    expect(css).toContain('@tailwind base;');
    expect(css).toContain('@tailwind utilities;');
    expect(css).toContain('body { margin: 0; }');
  });

  it('leaves a stylesheet that already agrees with its toolchain', () => {
    const files = [
      manifest('^4.1.0'),
      page,
      file('src/app/globals.css', '@import "tailwindcss";\n\nbody { margin: 0; }\n'),
    ];

    expect(tailwindStylesProblem(files)).toBeUndefined();

    const once = repairGlobalStyles(files);
    const css = once.find((entry) => entry.path === 'src/app/globals.css')!.content;

    /*
     * The entry is left as it is, and the rules with it. Blank lines may move —
     * import hoisting rewrites whitespace for every stylesheet — so this checks
     * the substance rather than the formatting.
     */
    expect(css).toContain('@import "tailwindcss";');
    expect(css).not.toMatch(/@tailwind\s+base/);
    expect(css).toContain('body { margin: 0; }');
    expect(repairGlobalStyles(once)).toEqual(once);
  });

  it('still adds an entry when there is none at all', () => {
    const repaired = repairGlobalStyles([
      manifest('^4.1.0'),
      page,
      file('src/app/globals.css', 'body { margin: 0; }\n'),
    ]);

    expect(repaired.find((entry) => entry.path === 'src/app/globals.css')!.content).toMatch(
      /^@import "tailwindcss";/,
    );
  });
});
