import {
  Braces,
  FileCode2,
  FileImage,
  FileText,
  Palette,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

/**
 * What kind of file this is, at a glance.
 *
 * A tree of forty identical page icons is a list you have to read word by word.
 * Shape and colour let the eye find the stylesheet or the config without
 * reading — which is most of what a file tree is for.
 *
 * Grouped by what a reader is looking for, not by extension: every image is one
 * thing whether it is an SVG or a PNG, and every build config is one thing
 * whether it is TOML or JSON.
 */
export interface FileLook {
  readonly icon: LucideIcon;
  /** A design token class, so these stay inside the palette. */
  readonly className: string;
}

const CONFIG_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'next.config.mjs',
  'next.config.js',
  'next.config.ts',
  'tailwind.config.ts',
  'tailwind.config.js',
  'postcss.config.js',
  'postcss.config.mjs',
  'vite.config.ts',
  'app.json',
  '.eslintrc.json',
  'eslint.config.js',
]);

export function fileLook(path: string): FileLook {
  const name = path.split('/').pop() ?? path;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

  /* Configuration first: package.json is a config, not a data file. */
  if (CONFIG_NAMES.has(name) || name.startsWith('.env') || name.startsWith('.')) {
    return { icon: Settings2, className: 'text-text-muted' };
  }

  if (/^(css|scss|sass|less)$/.test(extension)) {
    return { icon: Palette, className: 'text-accent' };
  }

  if (/^(svg|png|jpg|jpeg|gif|webp|avif|ico)$/.test(extension)) {
    return { icon: FileImage, className: 'text-success' };
  }

  if (/^(json|jsonc|yaml|yml|toml)$/.test(extension)) {
    return { icon: Braces, className: 'text-warning' };
  }

  if (/^(md|mdx|txt)$/.test(extension)) {
    return { icon: FileText, className: 'text-text-muted' };
  }

  if (/^(ts|tsx|js|jsx|mjs|cjs|html|vue)$/.test(extension)) {
    return { icon: FileCode2, className: 'text-text-secondary' };
  }

  return { icon: FileText, className: 'text-text-muted' };
}

/** The language id the highlighter should use for a path. */
export function languageFor(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : 'plain';
}
