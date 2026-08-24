/**
 * The pages the preview offers to open.
 *
 * Every route here comes from a file that defines it, so the menu cannot offer
 * a page that 404s — which is the failure that would make this feature worse
 * than not having it.
 */
import { describe, expect, it } from 'vitest';
import { siteRoutes } from '@/lib/site-routes';

const paths = (files: readonly string[]) => siteRoutes(files).map((route) => route.path);

describe('finding pages', () => {
  it('reads routes from the files that define them', () => {
    expect(
      paths(['app/page.tsx', 'app/menu/page.tsx', 'app/visit/page.tsx', 'components/Hero.tsx']),
    ).toEqual(['/', '/menu', '/visit']);
  });

  it('handles nested pages', () => {
    expect(paths(['app/blog/archive/page.tsx'])).toEqual(['/blog/archive']);
  });

  /* Route groups organise files; they do not appear in the URL. */
  it('drops route groups from the path', () => {
    expect(paths(['app/(marketing)/about/page.tsx'])).toEqual(['/about']);
  });

  /*
   * A dynamic segment needs a value nobody here has. Offering `/blog/[slug]`
   * would be offering a page that cannot load.
   */
  it('skips dynamic and parallel routes rather than linking to them', () => {
    expect(paths(['app/page.tsx', 'app/blog/[slug]/page.tsx', 'app/@modal/page.tsx'])).toEqual([
      '/',
    ]);
  });

  it('ignores route handlers, which are not pages', () => {
    expect(paths(['app/page.tsx', 'app/api/subscribe/route.ts'])).toEqual(['/']);
  });

  /* Returning nothing would leave the preview with no address to load. */
  it('always offers at least the homepage', () => {
    expect(siteRoutes([])).toEqual([{ path: '/', label: 'Homepage' }]);
    expect(siteRoutes(['components/Hero.tsx'])).toEqual([{ path: '/', label: 'Homepage' }]);
  });

  it('puts the homepage first, then the rest in order', () => {
    expect(paths(['app/visit/page.tsx', 'app/menu/page.tsx', 'app/page.tsx'])).toEqual([
      '/',
      '/menu',
      '/visit',
    ]);
  });
});

describe('what the pages are called', () => {
  it('names them in words rather than in paths', () => {
    const routes = siteRoutes(['app/page.tsx', 'app/our-story/page.tsx']);
    expect(routes.map((route) => route.label)).toEqual(['Homepage', 'Our story']);
  });

  it('shows nesting in the label', () => {
    expect(siteRoutes(['app/blog/archive/page.tsx'])[0]?.label).toBe('Blog / Archive');
  });
});
