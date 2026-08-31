import type { GeneratedFile } from './parse';

const LAYOUTS = ['app/layout.tsx', 'src/app/layout.tsx', 'app/layout.jsx', 'src/app/layout.jsx'];

/** Ensure a generated Next App Router application actually loads its global CSS. */
export function repairGlobalStyles(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const layout = LAYOUTS.find((path) => files.some((file) => file.path === path));
  if (!layout) return files;

  const directory = layout.slice(0, layout.lastIndexOf('/'));
  const stylesheet = files.find((file) => file.path === `${directory}/globals.css`);
  if (!stylesheet) return files;

  return files.map((file) => {
    if (file.path !== layout) return file;
    if (/import\s+['"]\.\/globals\.css['"]\s*;?/.test(file.content)) return file;

    const directive = /^(?:\s*['"]use (?:client|server)['"]\s*;?\s*\n)/.exec(file.content);
    const at = directive?.[0].length ?? 0;
    return {
      ...file,
      content: `${file.content.slice(0, at)}import './globals.css';\n${file.content.slice(at)}`,
    };
  });
}
