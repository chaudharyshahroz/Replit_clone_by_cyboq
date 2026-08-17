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

/**
 * The sidebar advertises what the product can do. It drifted once: Connections
 * shipped fully built — page, OAuth routes, revoke — while the nav still read
 * "Soon" and pointed at /connections, a route that never existed. A working
 * feature nobody can reach is the same as an unbuilt one.
 */
console.log('\n5. Sidebar navigation matches the routes that exist');
const sidebar = readFileSync(
  join(root, 'apps/web/src/components/app/sidebar.tsx'),
  'utf8',
);
const navItems = [
  ...sidebar.matchAll(/href: '([^']+)', label: '([^']+)'[^}]*?available: (true|false)/g),
].map((match) => ({
  href: match[1]!,
  label: match[2]!,
  available: match[3] === 'true',
}));

check('nav items were parsed', navItems.length > 0, `${navItems.length} entries`);

/** Every page under the app shell, so "built somewhere else" is detectable. */
const appPages: string[] = [];
const collectPages = (dir: string, prefix: string): void => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) {
      collectPages(child, `${prefix}/${entry}`);
    } else if (entry === 'page.tsx') {
      appPages.push(prefix.replace(/^\//, ''));
    }
  }
};
collectPages(join(root, 'apps/web/src/app/(app)'), '');

for (const item of navItems) {
  const pagePath = join(root, 'apps/web/src/app/(app)', item.href.replace(/^\//, ''), 'page.tsx');
  let hasPage = true;
  try {
    statSync(pagePath);
  } catch {
    hasPage = false;
  }

  if (item.available) {
    check(
      `${item.label} (${item.href})`,
      hasPage,
      hasPage ? '' : 'nav claims it is available but there is no page',
    );
    continue;
  }

  /**
   * An item marked "Soon" whose href has no page is *self*-consistent, which
   * is precisely how the real drift hid: Connections was fully built at
   * /settings/connections while the nav pointed at /connections and said
   * "Soon". Comparing href against available would have passed.
   *
   * So the check for unavailable items is different: does a page implementing
   * this feature exist anywhere under the app, at any path?
   */
  const slug = item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const builtElsewhere = appPages.filter((page) => page.split('/').includes(slug));
  check(
    `${item.label} is genuinely unbuilt`,
    builtElsewhere.length === 0,
    builtElsewhere.length > 0
      ? `marked "Soon" but a page exists at ${builtElsewhere.join(', ')}`
      : '',
  );
}

/**
 * Every surface that calls a model must meter it.
 *
 * Create and Agents both shipped without a quota check or a usage record.
 * Image generation — the single most expensive operation in the product — was
 * entirely unmetered, and one agent run is a loop of model calls, so an
 * exhausted workspace could spend through a whole plan unnoticed. Nothing
 * failed; the spend simply did not appear anywhere.
 *
 * A package that reaches a provider and does not record usage is a billing
 * hole, so it is checked rather than remembered.
 */
console.log('\n6. Every model-calling package meters its usage');

const readAll = (files: readonly string[]): string =>
  files
    .map((file) => {
      try {
        return readFileSync(join(root, file), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');

/** Every tracked source file, so a package's callers can be found. */
const allSources = [...tracked].filter((file) => /\.(ts|tsx|mts)$/.test(file));

for (const dir of ['packages/create', 'packages/agents', 'packages/research']) {
  const own = sourceFilesUnder(dir).filter((file) => !file.includes('__tests__'));
  const ownText = readAll(own);

  // Skipped when the package never reaches a provider.
  if (!ownText.includes('provider.generate') && !ownText.includes('provider.stream')) continue;

  /**
   * Metering may live in the package OR in the entry points that drive it.
   * Research is metered by its API route and worker handler rather than
   * inside the package, and that is correct — the first version of this check
   * called it a violation, which would have taught everyone to ignore the
   * check.
   */
  const packageName = `@reklu/${dir.split('/')[1]}`;
  const callers = allSources.filter(
    (file) => !file.startsWith(`${dir}/`) && !file.includes('__tests__') &&
      readAll([file]).includes(`from '${packageName}'`),
  );
  const combined = ownText + readAll(callers);

  for (const [label, needle] of [
    ['checks quota', 'checkQuota'],
    ['records usage', 'recordUsage'],
  ] as const) {
    const met = combined.includes(needle);
    check(
      `${dir} ${label}`,
      met,
      met ? '' : `reaches a provider but neither it nor its ${callers.length} callers call ${needle}`,
    );
  }
}

/**
 * No client component may import a package that reaches the database.
 *
 * Made three times — @reklu/skills, @reklu/mcp, @reklu/billing — always for one
 * small helper or constant, and always caught only by a failed production
 * build. The server should format and pass a value down, or the constant
 * should be inlined.
 */
console.log('\n7. No client component imports a server-only package');

const SERVER_ONLY = [
  '@reklu/database', '@reklu/billing', '@reklu/mcp', '@reklu/skills',
  '@reklu/agents', '@reklu/create', '@reklu/research', '@reklu/build',
  '@reklu/projects', '@reklu/artifacts', '@reklu/storage', '@reklu/queue',
  '@reklu/auth', '@reklu/integrations',
];

const clientOffenders: string[] = [];
for (const file of allSources.filter((name) => name.startsWith('apps/web/'))) {
  const text = readAll([file]);
  if (!/^\s*['"]use client['"]/m.test(text)) continue;

  /**
   * Only VALUE imports matter. `import type { X } from '@reklu/database'` is
   * erased at compile time and costs the bundle nothing — flagging it would
   * report correct code as broken, which is how a check earns its way onto
   * everyone's ignore list.
   */
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import type') || trimmed.startsWith('export type')) continue;

    for (const pkg of SERVER_ONLY) {
      if (trimmed.includes(`from '${pkg}'`)) clientOffenders.push(`${file} imports ${pkg}`);
    }
  }
}

check(
  'client components import no server-only package',
  clientOffenders.length === 0,
  clientOffenders.slice(0, 4).join(' | '),
);

console.log(
  failures === 0
    ? '\nAll checks passed. A fresh clone contains everything the build needs.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
