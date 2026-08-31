import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '../parse';
import { repairGlobalStyles } from '../repair-styles';

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
