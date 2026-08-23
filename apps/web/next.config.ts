import type { NextConfig } from 'next';
import { loadRootEnv } from './load-root-env';

// Reklu keeps one .env at the monorepo root, shared by web, worker and db tools.
loadRootEnv();

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * Next advertises itself in X-Powered-By by default. That tells an attacker
   * which framework CVEs to try and buys nothing in return. Found by
   * pnpm verify:security against production.
   */
  poweredByHeader: false,

  // Workspace packages ship TypeScript source (see docs/DECISIONS.md D1).
  transpilePackages: [
    '@reklu/shared',
    '@reklu/database',
    '@reklu/auth',
    '@reklu/ai',
    '@reklu/queue',
    '@reklu/storage',
    '@reklu/projects',
    '@reklu/artifacts',
    '@reklu/research',
    '@reklu/sandbox',
    '@reklu/build',
    '@reklu/integrations',
    '@reklu/skills',
    '@reklu/mcp',
    '@reklu/create',
    '@reklu/agents',
    '@reklu/billing',
    '@reklu/integrations',
    '@reklu/skills',
    '@reklu/mcp',
    '@reklu/create',
    '@reklu/agents',
    '@reklu/billing',
  ],

  // postgres.js and other node-native deps must not be bundled for the server.
  serverExternalPackages: ['postgres', 'ioredis', 'bullmq'],

  /*
   * The preview domain as it was at compile time, frozen into the bundle.
   *
   * next.config's headers() is evaluated while building and its result is
   * baked into the image, so the Content-Security-Policy cannot see a value
   * supplied later. Keeping the compile-time value lets the running app notice
   * when it disagrees with the configured one and say so — the alternative is
   * a preview that is refused with no indication of why, which cost several
   * rounds of looking in the wrong place.
   */
  env: {
    REKLU_BUILT_PREVIEW_DOMAIN: process.env.SANDBOX_PREVIEW_DOMAIN?.trim() ?? '',
  },

  // Type errors must fail the build — never ship a build that skipped them.
  typescript: { ignoreBuildErrors: false },

  async headers() {
    /**
     * Content-Security-Policy (spec §111).
     *
     * The app had none, which meant any injected script would have run with
     * full access to the session cookie's origin. This is the single largest
     * defence against an XSS that slips through React's escaping.
     *
     * Two allowances are deliberate and narrow:
     *
     *   - `js.whop.com` and `frame-src` for Whop, because embedded checkout
     *     loads their script and renders their iframe. Payments cannot work
     *     without it, and it is one named host rather than a wildcard.
     *   - `'unsafe-inline'` for styles only. Tailwind and Next inject inline
     *     style attributes; scripts get no such exemption, which is where it
     *     would actually matter.
     *
     * `frame-ancestors 'none'` is the modern form of X-Frame-Options, kept
     * alongside it for browsers that only honour the older header.
     */
    /*
     * Build previews, when they are served from a domain of their own.
     *
     * A generated application is framed by the build workspace, and `frame-src`
     * decides whether the browser will allow that at all. Without this the
     * frame was refused before the preview was even requested — and Chrome says
     * only "this content is blocked", which reads as a fault in the preview
     * rather than in the page doing the framing. The preview itself worked
     * perfectly when opened directly, which made it look like Reklu was
     * breaking something it was in fact forbidding.
     *
     * A wildcard over one subdomain Reklu itself controls, and only when that
     * subdomain is configured: every sandbox gets its own name under it, so
     * there is no fixed host to name.
     */
    const previewDomain = process.env.SANDBOX_PREVIEW_DOMAIN?.trim();
    const previewFrameSrc = previewDomain ? ` https://*.${previewDomain}` : '';

    const csp = [
      "default-src 'self'",
      // 'unsafe-eval' is NOT granted: nothing in Reklu needs it, and it is the
      // difference between an injected string and injected code.
      "script-src 'self' 'unsafe-inline' https://js.whop.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.whop.com https://js.whop.com",
      // Whop's checkout iframe, and build previews when they have a domain.
      `frame-src 'self' https://whop.com https://js.whop.com${previewFrameSrc}`,
      "object-src 'none'",
      "base-uri 'self'",
      // A form posting off-origin is exfiltration, not a feature Reklu has.
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      /**
       * Apple's merchant domain verification file.
       *
       * Served from `public/.well-known/` with no extension, so Next hands it
       * back as `application/octet-stream`. Apple compares the bytes rather
       * than the type, but `nosniff` is set globally and an octet-stream is
       * the one thing a fetcher might refuse to read as text — so the type is
       * stated rather than left to a default.
       *
       * Listed before the catch-all: the first matching source wins for a
       * given header key.
       */
      {
        source: '/.well-known/apple-developer-merchantid-domain-association',
        headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Only meaningful over HTTPS; harmless in development where it is
          // ignored, and required in production where the session cookie lives.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default config;
