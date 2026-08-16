import type { NextConfig } from 'next';
import { loadRootEnv } from './load-root-env';

// Reklu keeps one .env at the monorepo root, shared by web, worker and db tools.
loadRootEnv();

const config: NextConfig = {
  reactStrictMode: true,

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
  ],

  // postgres.js and other node-native deps must not be bundled for the server.
  serverExternalPackages: ['postgres', 'ioredis', 'bullmq'],

  // Type errors must fail the build — never ship a build that skipped them.
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
