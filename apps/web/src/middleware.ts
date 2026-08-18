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

/** Paths that must work on both hosts for anything else to function. */
const SHARED_PREFIXES = ['/api/auth', '/login', '/logout', '/api/health', '/_next', '/favicon'];

function isShared(pathname: string): boolean {
  return SHARED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest): NextResponse {
  /**
   * Read from the env at request time rather than module scope.
   *
   * Middleware runs on the edge runtime, where `loadServerEnv` (Node crypto,
   * zod, a database import chain) is not available. Reading the one variable
   * directly keeps this file free of that dependency.
   */
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase();
  if (!adminHost) return NextResponse.next();

  // `host` may carry a port in development; compare the hostname only.
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0] ?? '';
  const { pathname } = request.nextUrl;

  if (host === adminHost) {
    // The admin host's root is the admin panel, not the product home.
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }

    if (pathname.startsWith('/admin') || isShared(pathname)) {
      return NextResponse.next();
    }

    /**
     * A product path on the admin host is sent to the product rather than
     * 404'd, so a stray link is useful instead of broken.
     */
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      return NextResponse.redirect(new URL(pathname, appUrl));
    }
    return NextResponse.redirect(new URL('/admin', request.url));
  }

  /**
   * On the product host, admin does not exist. Rewriting to the 404 rather
   * than redirecting means the response is indistinguishable from any other
   * missing page — a redirect to the admin host would confirm one exists.
   */
  if (pathname.startsWith('/admin')) {
    return NextResponse.rewrite(new URL('/_not-found', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Static assets and image optimisation are excluded: they are host-agnostic,
   * and running middleware on every one of them costs latency for no decision.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
