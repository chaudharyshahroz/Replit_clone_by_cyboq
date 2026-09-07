import type { GeneratedFile } from './parse';

const LAYOUTS = ['app/layout.tsx', 'src/app/layout.tsx', 'app/layout.jsx', 'src/app/layout.jsx'];

function packageManifest(files: readonly GeneratedFile[]): Record<string, unknown> | undefined {
  const source = files.find((file) => file.path === 'package.json')?.content;
  if (!source) return undefined;
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dependencyVersion(manifest: Record<string, unknown> | undefined, name: string): string {
  for (const field of ['dependencies', 'devDependencies']) {
    const dependencies = manifest?.[field];
    if (dependencies && typeof dependencies === 'object') {
      const value = (dependencies as Record<string, unknown>)[name];
      if (typeof value === 'string') return value;
    }
  }
  return '';
}

export function tailwindStylesProblem(files: readonly GeneratedFile[]): string | undefined {
  const manifest = packageManifest(files);
  const version = dependencyVersion(manifest, 'tailwindcss');
  if (!version) return undefined;

  const visual = files
    .filter((file) => /\.(?:tsx|jsx|html)$/.test(file.path))
    .map((file) => file.content)
    .join('\n');
  if (!/(?:className|class)\s*=/.test(visual)) return undefined;

  const stylesheets = files.filter((file) => /(?:^|\/)(?:globals|index)\.css$/.test(file.path));
  if (stylesheets.some((file) => /@tailwind\s+(?:base|components|utilities)|@import\s+['"]tailwindcss['"]/.test(file.content))) {
    return undefined;
  }

  return 'Components use Tailwind utility classes, but globals.css never loads Tailwind, so those classes compile to no CSS.';
}

function addTailwindEntry(content: string, version: string): string {
  const major = Number(/\d+/.exec(version)?.[0] ?? 3);
  const entry = major >= 4
    ? '@import "tailwindcss";\n'
    : '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n';

  /* CSS imports must remain before ordinary rules. Preserve leading font imports. */
  const imports = /^(?:(?:@charset[^;]+;|@import[^;]+;)\s*)*/.exec(content)?.[0] ?? '';
  return `${imports}${entry}${content.slice(imports.length)}`;
}

/** Ensure a generated Next App Router application actually loads its global CSS. */
export function repairGlobalStyles(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const manifest = packageManifest(files);
  const tailwindVersion = dependencyVersion(manifest, 'tailwindcss');
  const tailwindMajor = Number(/\d+/.exec(tailwindVersion)?.[0] ?? 0);
  const missingTailwindEntry = tailwindStylesProblem(files) !== undefined;
  const tailwindStylesheet = files.find((file) => /(?:^|\/)(?:globals|index)\.css$/.test(file.path));
  let repaired = files.map((file) => {
    let content = file.content;
    if (file.path === tailwindStylesheet?.path && tailwindVersion && missingTailwindEntry) {
      content = addTailwindEntry(content, tailwindVersion);
    }
    if (
      tailwindMajor > 0 &&
      tailwindMajor < 4 &&
      /(?:^|\/)postcss\.config\.(?:[cm]?js|ts)$/.test(file.path)
    ) {
      content = content.replaceAll('@tailwindcss/postcss', 'tailwindcss');
    }
    if (
      tailwindMajor >= 4 &&
      /(?:^|\/)postcss\.config\.(?:[cm]?js|ts)$/.test(file.path)
    ) {
      content = content
        .replace(/(['"])tailwindcss\1/g, (_match, quote: string) =>
          `${quote}@tailwindcss/postcss${quote}`,
        )
        .replace(/\btailwindcss\s*:/g, "'@tailwindcss/postcss':");
    }
    return content === file.content ? file : { ...file, content };
  });

  const layout = LAYOUTS.find((path) => repaired.some((file) => file.path === path));
  if (!layout) return repaired;

  const directory = layout.slice(0, layout.lastIndexOf('/'));
  const stylesheet = repaired.find((file) => file.path === `${directory}/globals.css`);
  if (!stylesheet) return repaired;

  repaired = repaired.map((file) => {
    if (file.path !== layout) return file;
    if (/import\s+['"]\.\/globals\.css['"]\s*;?/.test(file.content)) return file;

    const directive = /^(?:\s*['"]use (?:client|server)['"]\s*;?\s*\n)/.exec(file.content);
    const at = directive?.[0].length ?? 0;
    return {
      ...file,
      content: `${file.content.slice(0, at)}import './globals.css';\n${file.content.slice(at)}`,
    };
  });
  return repaired;
}
