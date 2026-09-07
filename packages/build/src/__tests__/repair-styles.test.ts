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
});
