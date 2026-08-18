import { describe, expect, it } from 'vitest';
import { middleware } from '../middleware';

/**
 * Regression: the first version of this middleware read
 * `process.env.ADMIN_HOST`. Middleware runs on the edge runtime, where
 * `process.env` is inlined at BUILD time — so a variable supplied at runtime by
 * Compose was always undefined, the middleware returned early, and
 * admin.reklu.app served the marketing page. Nothing failed and nothing logged
 * it. The host is now decided from the request, which cannot be misconfigured.
 */
const request = (url: string): Parameters<typeof middleware>[0] => {
  const parsed = new URL(url);
  return {
    headers: new Headers({ host: parsed.host }),
    nextUrl: parsed,
    url,
  } as unknown as Parameters<typeof middleware>[0];
};

const location = (response: ReturnType<typeof middleware>): string | null =>
  response.headers.get('location');

describe('admin host routing', () => {
  it('sends the admin host root to the admin panel', () => {
    const response = middleware(request('https://admin.reklu.app/'));
    expect(location(response)).toBe('https://admin.reklu.app/admin');
  });

  it('serves /admin on the admin host', () => {
    const response = middleware(request('https://admin.reklu.app/admin'));
    expect(location(response)).toBeNull();
  });

  it('serves /admin subpages on the admin host', () => {
    expect(location(middleware(request('https://admin.reklu.app/admin/users')))).toBeNull();
  });

  /** Login has to work there, or an operator can never sign in. */
  it.each(['/login', '/api/auth/oauth/github/start', '/api/health', '/_next/static/x.js'])(
    'allows %s on the admin host',
    (path) => {
      expect(location(middleware(request(`https://admin.reklu.app${path}`)))).toBeNull();
    },
  );

  it('sends a product path on the admin host to the panel', () => {
    const response = middleware(request('https://admin.reklu.app/chat'));
    expect(location(response)).toBe('https://admin.reklu.app/admin');
  });

  /**
   * On the product host admin must not exist. A rewrite, not a redirect — a
   * redirect to the admin host would confirm there is one.
   */
  it('hides /admin on the product host', () => {
    const response = middleware(request('https://app.reklu.app/admin'));
    expect(location(response)).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toContain('/_not-found');
  });

  it('leaves ordinary product paths alone', () => {
    expect(location(middleware(request('https://reklu.app/chat')))).toBeNull();
  });

  /**
   * A single-host deployment — development, or an apex-only production — keeps
   * /admin reachable, because there is no admin subdomain to send it to.
   */
  it.each(['http://localhost:3000/admin', 'https://reklu.app/admin'])(
    'keeps /admin reachable on a single host (%s)',
    (url) => {
      expect(location(middleware(request(url)))).toBeNull();
    },
  );

  it('ignores the port when matching the host', () => {
    const response = middleware(request('http://admin.localhost:3000/'));
    expect(location(response)).toBe('http://admin.localhost:3000/admin');
  });
});
