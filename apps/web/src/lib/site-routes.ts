/**
 * The pages a generated application actually has.
 *
 * Read from the file tree rather than guessed at or asked of the model: a route
 * exists because a file defines it, so this cannot list a page that will 404.
 *
 * Next's App Router is the convention every web target here is generated
 * against — `app/menu/page.tsx` serves `/menu` — and route groups in
 * parentheses organise files without appearing in the URL, which is the one
 * rule that would otherwise produce links to pages that are not there.
 */
export interface SiteRoute {
  /** The path to load, e.g. `/menu`. */
  readonly path: string;
  /** What to call it in a menu, e.g. `Menu`. */
  readonly label: string;
}

const APP_PAGE_FILE = /^(?:src\/)?app\/(.*\/)?page\.(tsx|jsx|ts|js)$/;
const PAGES_PAGE_FILE = /^(?:src\/)?pages\/(.*\/)?(?:index|([^/]+))\.(tsx|jsx|ts|js)$/;

/** Turn a directory segment into something worth reading in a menu. */
function labelFor(path: string): string {
  if (path === '/') return 'Homepage';

  return path
    .slice(1)
    .split('/')
    .map((segment) =>
      segment
        .replace(/[-_]/g, ' ')
        .replace(/^\w/, (character) => character.toUpperCase()),
    )
    .join(' / ');
}

export function siteRoutes(paths: readonly string[]): readonly SiteRoute[] {
  const routes = new Set<string>();

  for (const file of paths) {
    const appMatch = APP_PAGE_FILE.exec(file);
    const pagesMatch = PAGES_PAGE_FILE.exec(file);
    if (!appMatch && !pagesMatch) continue;

    const directory = appMatch?.[1] ?? pagesMatch?.[1] ?? '';
    const leaf = pagesMatch?.[2];
    const segments = `${directory}${leaf ?? ''}`
      .split('/')
      .filter((segment) => segment.length > 0)
      /*
       * Route groups organise files without appearing in the URL, and dynamic
       * segments need a value nobody here has — linking to `/blog/[slug]`
       * would be offering a page that cannot load.
       */
      .filter((segment) => !segment.startsWith('('));

    if (segments.some((segment) => segment.startsWith('[') || segment.startsWith('@'))) {
      continue;
    }

    routes.add(segments.length === 0 ? '/' : `/${segments.join('/')}`);
  }

  /* Home first, then alphabetical — the order someone would expect to find. */
  const sorted = [...routes].sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });

  /* Vite and Expo use entry files rather than Next's page convention. */
  if (sorted.length === 0) {
    const hasSinglePageEntry = paths.some(
      (path) => path === 'index.html' || /^(?:(?:src\/)?app\/index|App)\.(tsx|jsx|ts|js)$/.test(path),
    );
    return hasSinglePageEntry ? [{ path: '/', label: 'Homepage' }] : [];
  }

  return sorted.map((path) => ({ path, label: labelFor(path) }));
}
