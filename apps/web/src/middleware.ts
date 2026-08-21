/**
 * Host-based separation of the product and the admin panel (spec §78).
 *
 * With `ADMIN_HOST` set, the two are separate surfaces on one deployment:
 *
 *   admin.reklu.app  serves ONLY /admin — its root redirects there, and any
 *                    product path is refused.
 *   reklu.app        refuses /admin outright, as though it did not exist.
 *
 * The point is blast radius. An XSS in the product cannot reach an admin route,
 * because on that origin there are no admin routes to reach. It costs one
 * middleware rather than a second container to build, deploy and patch.
 *
 * This is a routing boundary, not authorisation. `requireSuperAdmin` still runs
 * on every admin page — a host header is client-supplied and a proxy can be
 * misconfigured, so it is never the only thing standing in the way.
 */
import { NextResponse, type NextRequest } from 'next/server';

/**
 * The session cookie's name, inlined.
 *
 * Middleware runs on the edge runtime, which cannot import @reklu/auth — that
 * package reaches the database. The name is a constant either way, and this
 * file already avoids reading `process.env` for the same class of reason.
 */
const SESSION_COOKIE = 'reklu.session';

/** Paths that must work on both hosts for anything else to function. */
const SHARED_PREFIXES = ['/api/auth', '/login', '/logout', '/api/health', '/_next', '/favicon'];

function isShared(pathname: string): boolean {
  return SHARED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Whether a request arrived on the admin host.
 *
 * Decided from the hostname itself rather than from `ADMIN_HOST`, and that is
 * deliberate. Middleware runs on the edge runtime, where `process.env` is
 * INLINED AT BUILD TIME — so a variable supplied at runtime by Compose is
 * `undefined` here no matter what the operator sets. The first attempt at this
 * file read `process.env.ADMIN_HOST` and silently did nothing in production:
 * admin.reklu.app served the marketing page, and nothing in any log said why.
 *
 * A convention needs no build-time coupling and cannot be misconfigured: the
 * `admin` label is the admin host. `ADMIN_HOST` still exists for the cookie
 * check and the docs, but routing no longer depends on reading it here.
 */
function isAdminHost(host: string): boolean {
  const [label] = host.split('.');
  return label === 'admin';
}

export function middleware(request: NextRequest): NextResponse {
  // `host` may carry a port in development; compare the hostname only.
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0] ?? '';
  const { pathname } = request.nextUrl;

  /**
   * A single-host deployment has no admin subdomain, so nothing is rewritten
   * and /admin stays reachable on the one host — which is what development
   * needs.
   */
  if (!isAdminHost(host)) {
    /**
     * A signed-in visitor asking for the landing page wants the product.
     *
     * Inside this branch deliberately: the admin host has its own rule for
     * `/`, and running this first would have sent an administrator to /chat
     * instead of /admin.
     *
     * Decided from the presence of the session cookie rather than by
     * validating it, because validating means a database read on the one page
     * that is static and the most visited in the product. Being wrong is cheap
     * and self-correcting: a stale cookie sends someone to /chat, which sends
     * them to sign in.
     */
    if (pathname === '/' && request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL('/chat', request.url));
    }

    if (pathname.startsWith('/admin') && host.split('.').length > 2) {
      /**
       * A multi-label host that is NOT the admin host must not serve /admin.
       * Rewritten to the 404 rather than redirected: a redirect to the admin
       * host would confirm one exists.
       */
      return NextResponse.rewrite(new URL('/_not-found', request.url));
    }
    return NextResponse.next();
  }

  {
    // The admin host's root is the admin panel, not the product home.
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }

    if (pathname.startsWith('/admin') || isShared(pathname)) {
      return NextResponse.next();
    }

    /**
     * A product path on the admin host goes to the admin panel rather than
     * being rewritten to the product, because reaching the product would need
     * the product's hostname — which this file deliberately no longer reads
     * from the environment.
     */
    return NextResponse.redirect(new URL('/admin', request.url));
  }
}

export const config = {
  /**
   * Static assets and image optimisation are excluded: they are host-agnostic,
   * and running middleware on every one of them costs latency for no decision.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
