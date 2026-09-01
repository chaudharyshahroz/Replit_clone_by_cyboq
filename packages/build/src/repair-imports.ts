/**
 * Make the `@/` alias mean what the files assume it means.
 *
 * Generated applications import through `@/components/Header` and then ship a
 * tsconfig whose `paths` do not map `@/` anywhere useful — or omit it entirely.
 * Nothing catches that: the tree looks complete, every file exists, and the
 * application fails to compile on the first request with "Module not found",
 * which reaches the reader as a white frame.
 *
 * Repaired mechanically rather than by asking the model again. Where the alias
 * should point is not a judgement — it is wherever `components` actually is —
 * so a second generation would be slower, cost a call, and could just as easily
 * get it wrong twice.
 */
import type { GeneratedFile } from './parse';

const ALIAS_IMPORT = /(?:from|import)\s*\(?\s*['"]@\/([^'"]+)['"]/g;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', ''];

function resolves(paths: ReadonlySet<string>, reference: string): boolean {
  return SOURCE_EXTENSIONS.some(
    (extension) =>
      paths.has(`${reference}${extension}`) || paths.has(`${reference}/index${extension}`),
  );
}

/** Repair a locally invented alias path when the intended file is unambiguous. */
export function repairLocalImportPaths(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const paths = new Set(files.map((file) => file.path));
  const root = paths.has('src/app/page.tsx') || [...paths].some((path) => path.startsWith('src/'))
    ? 'src/'
    : '';

  return files.map((file) => {
    let content = file.content;
    for (const match of file.content.matchAll(ALIAS_IMPORT)) {
      const reference = match[1];
      if (!reference || resolves(paths, `${root}${reference}`)) continue;

      const candidates = new Set<string>();
      const componentReference = `components/${reference}`;
      if (resolves(paths, `${root}${componentReference}`)) candidates.add(componentReference);

      const basename = reference.split('/').pop()?.toLowerCase();
      if (basename) {
        for (const path of paths) {
          const withoutRoot = root && path.startsWith(root) ? path.slice(root.length) : path;
          const withoutExtension = withoutRoot.replace(/\.(?:tsx?|jsx?|css)$/, '');
          if (withoutExtension.split('/').pop()?.toLowerCase() === basename) {
            candidates.add(withoutExtension.replace(/\/index$/, ''));
          }
        }
      }

      if (candidates.size === 1) {
        content = content.replaceAll(`@/${reference}`, `@/${[...candidates][0]!}`);
      }
    }
    return content === file.content ? file : { ...file, content };
  });
}

/**
 * Remove comments, without touching the contents of strings.
 *
 * Scanned rather than matched. A regular expression cannot tell a comment from
 * the same characters inside a string, and a tsconfig is full of the same
 * characters inside strings: `"@/*"` opens what looks like a block comment and
 * `"**\/*.ts"` closes it, so a regex deletes everything between two unrelated
 * path patterns and leaves invalid JSON behind.
 */
function stripJsonComments(source: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];

    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        out += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      out += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      out += character;
      continue;
    }

    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    out += character;
  }

  return out;
}

/** Parse a tsconfig, tolerating the comments TypeScript allows in one. */
export function parseTsconfig(source: string): Record<string, unknown> | undefined {
  /*
   * Plain JSON first. Most generated configs are, and parsing them directly
   * avoids putting a rewriting step between the file and its meaning.
   */
  const attempts = [source, stripJsonComments(source).replace(/,(\s*[}\]])/g, '$1')];

  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // Try the next reading of it.
    }
  }

  return undefined;
}

/**
 * Where `@/` has to point for the imports in this tree to resolve.
 *
 * Decided from the files themselves: if something imports `@/components/Header`
 * and the tree holds `src/components/Header.tsx`, the alias means `./src/`.
 */
export function aliasTargetFor(files: readonly GeneratedFile[]): string | undefined {
  const paths = new Set(files.map((file) => file.path));
  const referenced = new Set<string>();

  for (const file of files) {
    for (const match of file.content.matchAll(ALIAS_IMPORT)) {
      if (match[1]) referenced.add(match[1]);
    }
  }

  if (referenced.size === 0) return undefined;

  const roots = ['', 'src/'];
  for (const root of roots) {
    const resolves = [...referenced].filter((reference) =>
      SOURCE_EXTENSIONS.some(
        (extension) =>
          paths.has(`${root}${reference}${extension}`) ||
          paths.has(`${root}${reference}/index${extension}`),
      ),
    ).length;

    /*
     * A majority, not all of them. One import of a file the model forgot to
     * write is a missing file, not evidence that the alias points elsewhere.
     */
    if (resolves > 0 && resolves * 2 >= referenced.size) {
      return root === '' ? './*' : `./${root}*`;
    }
  }

  return undefined;
}

/**
 * Ensure the tsconfig maps `@/` where the code expects it.
 *
 * Only rewrites when the mapping is absent or points somewhere the imports do
 * not resolve. A project that already agrees with itself is left exactly as it
 * is — reformatting a working config would be a change nobody asked for and a
 * diff nobody can read.
 */
export function repairAliasPaths(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const relocated = repairLocalImportPaths(files);
  const target = aliasTargetFor(relocated);
  if (!target) return relocated;

  const tsconfig = relocated.find((file) => file.path === 'tsconfig.json');
  if (!tsconfig) return relocated;

  const parsed = parseTsconfig(tsconfig.content);
  if (!parsed) return relocated;

  const compilerOptions = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
  const paths = (compilerOptions.paths ?? {}) as Record<string, unknown>;
  const existing = paths['@/*'];

  const alreadyCorrect =
    Array.isArray(existing) && existing.length > 0 && existing[0] === target;
  if (alreadyCorrect && compilerOptions.baseUrl) return relocated;

  const repaired = {
    ...parsed,
    compilerOptions: {
      ...compilerOptions,
      /* `paths` are resolved against this; without it they are ignored. */
      baseUrl: compilerOptions.baseUrl ?? '.',
      paths: { ...paths, '@/*': [target] },
    },
  };

  return relocated.map((file) =>
    file.path === 'tsconfig.json'
      ? { ...file, content: `${JSON.stringify(repaired, null, 2)}\n` }
      : file,
  );
}
