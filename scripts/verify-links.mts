/**
 * Every link on the public pages goes somewhere that exists.
 *
 * This exists because none of them did. The marketing nav pointed at /product
 * and /pricing, the footer added /integrations, /enterprise, /security,
 * /about, /terms and /privacy — eight routes that were never built — and both
 * linked /research, /build and /skills, which are app routes that redirect a
 * logged-out visitor to sign-in. Twelve of thirteen footer links and all five
 * nav links were dead, on the one page every visitor sees first.
 *
 * Nothing failed loudly: Next renders a <Link> to a missing route perfectly
 * happily and only 404s when someone clicks it, so a passing build and a
 * good-looking page said nothing about whether the navigation worked.
 *
 * Checked statically rather than over HTTP so it runs in CI without a server,
 * a database, or provider keys.
 *
 * Run: pnpm verify:links
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const marketing = join(root, 'apps/web/src/components/marketing');

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Every route the app router actually serves, with route groups removed. */
const routes = new Set<string>();
const collect = (dir: string, urlPath: string): void => {
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (!statSync(child).isDirectory()) {
      if (entry === 'page.tsx') routes.add(urlPath === '' ? '/' : urlPath);
      continue;
    }
    // (group) folders organise files without appearing in the URL.
    const segment = /^\(.*\)$/.test(entry) ? '' : `/${entry}`;
    collect(child, `${urlPath}${segment}`);
  }
};
collect(join(root, 'apps/web/src/app'), '');

/** Anchors the marketing page renders, for same-page links. */
const files = readdirSync(marketing).filter((f) => f.endsWith('.tsx'));
const anchors = new Set<string>();
const sources = new Map<string, string>();
for (const file of files) {
  const text = readFileSync(join(marketing, file), 'utf8');
  sources.set(file, text);
  for (const m of text.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) anchors.add(m[1]!);
}

console.log('\n1. Routes and anchors were discovered');
check('app routes found', routes.size > 0, `${routes.size} routes`);
check('page anchors found', anchors.size > 0, [...anchors].join(', '));

/**
 * App routes sit behind authentication, so linking one from a public page
 * sends an anonymous visitor to sign-in instead of the page they asked for.
 * That is a broken link even though the route exists.
 */
const authed = new Set(
  [...routes].filter((r) => {
    const inAppGroup = (() => {
      try {
        statSync(join(root, 'apps/web/src/app/(app)', r.replace(/^\//, ''), 'page.tsx'));
        return true;
      } catch {
        return false;
      }
    })();
    return inAppGroup;
  }),
);

console.log('\n2. Every public link resolves');
for (const [file, text] of sources) {
  /**
   * Both forms, because the first version of this check only matched the JSX
   * attribute and so read none of the links it was written to catch: nav and
   * footer declare theirs as `href: '/x'` inside a data array. It reported
   * "all checks passed" on a nav where every entry 404'd.
   */
  const hrefs = [
    ...text.matchAll(/href="([^"]+)"/g),
    ...text.matchAll(/\bhref:\s*['"]([^'"]+)['"]/g),
  ];
  for (const m of hrefs) {
    const href = m[1]!;
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;

    if (href.startsWith('#')) {
      const id = href.slice(1);
      check(`${file}: ${href}`, anchors.has(id), anchors.has(id) ? '' : 'no element has this id');
      continue;
    }

    const path = href.split(/[?#]/)[0]!;
    if (!routes.has(path)) {
      check(`${file}: ${href}`, false, 'no page.tsx serves this route — 404');
    } else if (authed.has(path)) {
      check(`${file}: ${href}`, false, 'app route — redirects a logged-out visitor to sign-in');
    } else {
      check(`${file}: ${href}`, true);
    }
  }
}

console.log(
  failures === 0
    ? '\nAll checks passed. Every public link goes somewhere real.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
