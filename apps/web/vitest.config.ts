import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The web app had no way to test a React component — only middleware, which is
 * pure logic. The sidebar carries real behaviour (menu state, inline rename,
 * delete-then-navigate), so it needs somewhere to be exercised.
 */
export default defineConfig({
  // Next compiles JSX with the automatic runtime; vitest has to be told the
  // same, or every component file fails on an undefined React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: [join(root, 'src/__tests__/setup.ts')],
  },
  resolve: {
    alias: { '@': join(root, 'src') },
  },
});
