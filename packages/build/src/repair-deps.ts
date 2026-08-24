/**
 * Add the packages the generated code imports but the manifest forgets.
 *
 * A model writes `import clsx from 'clsx'` and then writes a package.json
 * without it. The tree is complete and plausible, `npm install` succeeds, and
 * the application fails to compile on the first request — which reaches the
 * reader as a white frame, not as a missing line in a manifest.
 *
 * **Only packages on this list are ever added.** Installing whatever name
 * appears in an import would mean installing a name a model invented, and the
 * npm registry is full of typosquats waiting for exactly that. A missing
 * dependency is a broken build; an invented one is arbitrary code running in
 * the sandbox. So the list is deliberately short and deliberately boring: the
 * libraries a generated application actually reaches for.
 *
 * Anything not listed is left alone. The compile error that follows names the
 * package, which is a better outcome than guessing on the reader's behalf.
 */
import type { GeneratedFile } from './parse';

/** Packages worth adding automatically, with the range to add them at. */
const KNOWN: Readonly<Record<string, string>> = {
  clsx: '^2.1.1',
  'tailwind-merge': '^2.5.4',
  'class-variance-authority': '^0.7.0',
  zod: '^3.23.8',
  'date-fns': '^4.1.0',
  'lucide-react': '^0.454.0',
  'framer-motion': '^11.11.17',
  'react-hook-form': '^7.53.2',
  '@hookform/resolvers': '^3.9.1',
  swr: '^2.2.5',
  nanoid: '^5.0.8',
  slugify: '^1.6.6',
};

const IMPORT = /(?:from\s*['"]|import\s*\(\s*['"]|require\(\s*['"])([^'"]+)['"]/g;

/** The package a specifier belongs to, or nothing if it is not a package. */
export function packageFor(specifier: string): string | undefined {
  /* Relative and absolute paths are files in the project, not packages. */
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) {
    return undefined;
  }
  if (specifier.startsWith('node:')) return undefined;

  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Every package the tree imports. */
export function importedPackages(files: readonly GeneratedFile[]): ReadonlySet<string> {
  const found = new Set<string>();

  for (const file of files) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(file.path)) continue;

    for (const match of file.content.matchAll(IMPORT)) {
      const name = packageFor(match[1] ?? '');
      if (name) found.add(name);
    }
  }

  return found;
}

export function repairMissingDependencies(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const manifestFile = files.find((file) => file.path === 'package.json');
  if (!manifestFile) return files;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestFile.content) as Record<string, unknown>;
  } catch {
    /* A manifest that is not JSON is one to leave alone rather than rewrite. */
    return files;
  }

  const dependencies = { ...((manifest.dependencies ?? {}) as Record<string, string>) };
  const dev = (manifest.devDependencies ?? {}) as Record<string, string>;

  const missing = [...importedPackages(files)].filter(
    (name) => KNOWN[name] && !dependencies[name] && !dev[name],
  );

  if (missing.length === 0) return files;

  for (const name of missing) dependencies[name] = KNOWN[name]!;

  const repaired = { ...manifest, dependencies };

  return files.map((file) =>
    file.path === 'package.json'
      ? { ...file, content: `${JSON.stringify(repaired, null, 2)}\n` }
      : file,
  );
}
