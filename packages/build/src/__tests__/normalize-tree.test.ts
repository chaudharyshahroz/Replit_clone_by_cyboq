import { describe, expect, it } from 'vitest';
import { normalizeGeneratedTree } from '../normalize-tree';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({ path, content, language: 'typescript' });

describe('shared generated tree normalization', () => {
  it('repairs historical trees with missing dependencies, CSS imports, and JSX extensions together', () => {
    const tree = [
      file('package.json', '{"dependencies":{"next":"14.2.3"}}'),
      file('src/app/layout.tsx', 'export default function Layout() { return <html />; }'),
      file('src/app/globals.css', '@tailwind base;'),
      file('src/lib/constants.ts', "import clsx from 'clsx'; export const icon = <svg />;"),
    ];
    const result = normalizeGeneratedTree(tree);
    expect(result.find((entry) => entry.path === 'src/app/layout.tsx')!.content).toContain("import './globals.css'");
    expect(result.some((entry) => entry.path === 'src/lib/constants.tsx')).toBe(true);
    expect(JSON.parse(result.find((entry) => entry.path === 'package.json')!.content).dependencies.clsx).toBeDefined();
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });
});
