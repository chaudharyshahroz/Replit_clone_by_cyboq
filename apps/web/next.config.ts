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
    const csp = [
      "default-src 'self'",
      // 'unsafe-eval' is NOT granted: nothing in Reklu needs it, and it is the
      // difference between an injected string and injected code.
      "script-src 'self' 'unsafe-inline' https://js.whop.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.whop.com https://js.whop.com",
      // Whop's checkout iframe, and nothing else.
      "frame-src 'self' https://whop.com https://js.whop.com",
      "object-src 'none'",
      "base-uri 'self'",
      // A form posting off-origin is exfiltration, not a feature Reklu has.
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
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
