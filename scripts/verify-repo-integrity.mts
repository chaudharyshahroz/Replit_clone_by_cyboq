/**
 * Verifies that the repository actually contains the code you build.
 *
 * This exists because it once did not. `.gitignore` carried an unanchored
 * `build/`, which matches any directory of that name at any depth. It silently
 * excluded `packages/build`, `apps/web/src/app/(app)/build` and
 * `apps/web/src/components/build` from every commit — so the entire Build
 * feature was absent from the deployed image while working perfectly on the
 * development machine. Nothing failed: `pnpm install` linked a workspace
 * dependency whose directory did not exist, and because the only code
 * importing it was also excluded, the production build succeeded and simply
 * emitted no `/build` route.
 *
 * A local build passing proves nothing about what a fresh clone contains. This
 * compares the two.
 *
 * Run: pnpm verify:repo
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/**
 * `git check-ignore` exits 1 when nothing matched — which is the outcome this
 * script wants. Treating a non-zero exit as failure would invert the check.
 */
const gitAllowingNoMatch = (...args: string[]): string => {
  try {
    return git(...args);
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    return typeof output === 'string' ? output : '';
  }
};

/** Every file git currently tracks, as a set for O(1) membership. */
const tracked = new Set(git('ls-files').split('\n').filter(Boolean));

/** Workspace roots, read from the directory layout rather than a hard-coded list. */
function workspaceDirs(): string[] {
  const out: string[] = [];
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    for (const name of readdirSync(base)) {
      if (statSync(join(base, name)).isDirectory()) out.push(`${group}/${name}`);
    }
  }
  return out.sort();
}

/** Source files that must be in the repository for a clone to build. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (absolute: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      // Genuinely generated or installed — never expected in git.
      if (['node_modules', '.next', '.turbo', 'dist', '.sandbox', '.storage'].includes(entry)) {
        continue;
      }
      const child = join(absolute, entry);
      if (statSync(child).isDirectory()) {
        walk(child);
      } else if (/\.(ts|tsx|mts|css)$/.test(entry)) {
        found.push(relative(root, child));
      }
    }
  };
  walk(join(root, dir));
  return found;
}

console.log('\n1. Every workspace package is present in git');
const dirs = workspaceDirs();
for (const dir of dirs) {
  const count = [...tracked].filter((file) => file.startsWith(`${dir}/`)).length;
  check(dir, count > 0, count > 0 ? `${count} files` : 'NOTHING TRACKED — excluded by .gitignore?');
}

console.log('\n2. Every workspace package declares a manifest that git has');
for (const dir of dirs) {
  check(`${dir}/package.json`, tracked.has(`${dir}/package.json`));
}

console.log('\n3. No source file is silently excluded');
const untrackedSource: string[] = [];
for (const dir of dirs) {
  for (const file of sourceFilesUnder(dir)) {
    if (!tracked.has(file)) untrackedSource.push(file);
  }
}
check(
  'all .ts/.tsx/.mts/.css under apps and packages are tracked',
  untrackedSource.length === 0,
  untrackedSource.length > 0 ? untrackedSource.slice(0, 8).join(', ') : '',
);

/**
 * The specific trap: an ignore rule with no leading slash matches at every
 * depth. `build/` looks like "the build output directory" and behaves like
 * "any directory named build anywhere".
 */
console.log('\n4. No ignore rule can swallow a directory that shares a package name');
const packageNames = new Set(dirs.map((dir) => dir.split('/')[1]));
const dangerous: string[] = [];
for (const raw of gitAllowingNoMatch('check-ignore', '--verbose', '--no-index', ...dirs)
  .split('\n')
  .filter(Boolean)) {
  dangerous.push(raw);
}
check(
  'no workspace directory matches an ignore rule',
  dangerous.length === 0,
  dangerous.slice(0, 4).join(' | '),
);

// The working tree, not HEAD: this is the rule set that governs the next
// commit, which is the one that can still do damage.
const unanchored = readFileSync(join(root, '.gitignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && !line.startsWith('/') && line.endsWith('/'))
  .filter((line) => packageNames.has(line.slice(0, -1)));
check(
  'no unanchored ignore rule shares a name with a workspace package',
  unanchored.length === 0,
  unanchored.join(', '),
);

console.log(
  failures === 0
    ? '\nAll checks passed. A fresh clone contains everything the build needs.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
