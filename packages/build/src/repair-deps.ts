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
  tailwindcss: '^4.1.0',
  '@tailwindcss/postcss': '^4.1.0',
  postcss: '^8.4.47',
  autoprefixer: '^10.4.20',
};

/**
 * Exact versions emitted by providers that do not exist in the registry.
 *
 * Keep this list deliberately narrow. Valid exact pins are useful and should
 * stay exact; these are confirmed holes that make every cold preview fail.
 */
const KNOWN_UNAVAILABLE: Readonly<Record<string, string>> = {
  'typescript@5.4.0': '^5.4.0',
  // npm's published 1.x releases stop at 1.5.0, not 1.8.0.
  'react-swipeable@^1.8.0': '^1.5.0',
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

/**
 * Config files often name plugins as object keys instead of importing them.
 * Those references are executable dependency edges too, but only exact names
 * from the audited allowlist are accepted here.
 */
function configuredPackages(files: readonly GeneratedFile[]): ReadonlySet<string> {
  const found = new Set<string>();
  for (const file of files) {
    const isToolConfig = /(?:^|\/)(?:postcss|tailwind|next)\.config\.(?:[cm]?js|ts)$/.test(file.path);
    const isStylesheet = /\.css$/.test(file.path);
    if (!isToolConfig && !isStylesheet) continue;

    for (const name of Object.keys(KNOWN)) {
      if (file.content.includes(`'${name}'`) || file.content.includes(`"${name}"`)) {
        found.add(name);
      }
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
  const referenced = new Set([...importedPackages(files), ...configuredPackages(files)]);
  const tailwindVersion = dependencies.tailwindcss ?? dev.tailwindcss ?? '';
  const tailwindMajor = Number(/\d+/.exec(tailwindVersion)?.[0] ?? 0);

  const missing = [...referenced].filter(
    (name) =>
      KNOWN[name] &&
      !dependencies[name] &&
      !dev[name] &&
      // Tailwind 3 uses tailwindcss itself as the PostCSS plugin. A later
      // normalization step rewrites this common mixed-version config.
      !(name === '@tailwindcss/postcss' && tailwindMajor > 0 && tailwindMajor < 4),
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

/**
 * Repair a direct dependency version that the package manager proved does not
 * exist.
 *
 * A generated manifest can name a plausible-looking patch release such as
 * `typescript@5.4.0`. pnpm reports the exact package and version, so recovery
 * can be deterministic: broaden only that failed exact pin to its compatible
 * major range and retry once. Unknown packages are never added and valid pins
 * are never changed speculatively.
 */
export function repairUnavailableDependencyVersions(
  files: readonly GeneratedFile[],
  installOutput = '',
): readonly GeneratedFile[] {
  const manifestFile = files.find((file) => file.path === 'package.json');
  if (!manifestFile) return files;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestFile.content) as Record<string, unknown>;
  } catch {
    return files;
  }

  const replacements = new Map<string, string>();
  for (const [key, replacement] of Object.entries(KNOWN_UNAVAILABLE)) {
    replacements.set(key, replacement);
  }
  // The hook API is not part of the old default-component 1.x API. Only
  // select the verified modern release when the source actually imports it.
  if (files.some((file) => /import\s*\{[^}]*\buseSwipeable\b[^}]*\}\s*from\s*['"]react-swipeable['"]/.test(file.content))) {
    replacements.set('react-swipeable@^1.8.0', '^7.0.2');
  }

  const missingVersion =
    /No matching version found for ((?:@[^/\s]+\/)?[^@\s]+)@([^\s]+)(?:\s|$)/g;
  for (const match of installOutput.matchAll(missingVersion)) {
    const name = match[1];
    const version = match[2];
    if (!name || !version) continue;
    // pnpm supplies an authoritative release when a model invents a range.
    // Prefer a same-major repair, but if that release line does not exist the
    // registry-confirmed latest release is the only deterministic installable
    // recovery. The package must already be declared and named by pnpm; this
    // never installs a package inferred from arbitrary generated source text.
    const requested = /^([~^]?)(\d+)\.\d+\.\d+$/.exec(version);
    const latest = [...installOutput.matchAll(
      /The latest release of ((?:@[^/\s]+\/)?[^\s]+) is "(\d+\.\d+\.\d+)"/g,
    )].find((release) => release[1] === name)?.[2];
    if (requested && latest) {
      const sameMajor = latest.split('.')[0] === requested[2];
      replacements.set(`${name}@${version}`, `${sameMajor ? requested[1] : '^'}${latest}`);
      continue;
    }
    if (name && version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      replacements.set(`${name}@${version}`, `^${version}`);
    }
  }

  let changed = false;
  const repaired = { ...manifest };
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const original = manifest[field];
    if (!original || typeof original !== 'object' || Array.isArray(original)) continue;

    const dependencies = { ...(original as Record<string, unknown>) };
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== 'string') continue;
      const replacement = replacements.get(`${name}@${spec}`) ??
        // Providers confuse this with the older @next-auth adapter and invent
        // many different stable 1.x ranges. Repair the whole impossible line,
        // not only the exact ^1.7.0 observed in one build.
        (name === '@auth/prisma-adapter' && /^[~^]?1\.\d+\.\d+$/.test(spec)
          ? '^2.11.3'
          : undefined);
      if (!replacement) continue;
      dependencies[name] = replacement;
      changed = true;
    }
    repaired[field] = dependencies;
  }

  if (!changed) return files;
  return files.map((file) =>
    file.path === 'package.json'
      ? { ...file, content: `${JSON.stringify(repaired, null, 2)}\n` }
      : file,
  );
}
