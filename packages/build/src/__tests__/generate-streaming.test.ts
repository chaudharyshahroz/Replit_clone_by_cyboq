/**
 * Naming files as they are written.
 *
 * Generation was one call that returned everything at once, so for the two
 * minutes it took, the only honest thing a screen could say was "writing the
 * code" — which is indistinguishable from nothing happening. Streaming the
 * response means each file can be named at the moment it starts.
 *
 * The risk this pins is announcing the same file twice, or announcing something
 * that is not a file: both turn a truthful log into noise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());

vi.mock('@reklu/ai', () => ({ getProvider }));

import { generateFiles } from '../generate';
import type { BuildBrief } from '../brief';

const brief = {
  product: 'Coffee shop site',
  summary: 'A landing page',
  target: 'website',
  platforms: ['web'],
  userRoles: [],
  coreFeatures: [],
  pages: [],
  dataModel: [],
  stack: ['Next.js'],
  outOfScope: [],
  needsAuth: false,
  needsDatabase: false,
} as unknown as BuildBrief;

const model = {
  key: 'test',
  providerKey: 'test',
  modelIdentifier: 'test-1',
  maxOutputTokens: 8_000,
  bestFor: ['coding'],
} as never;

/** Emit a response one chunk at a time, the way a provider does. */
function emits(chunks: readonly string[]) {
  stream.mockImplementation(async function* () {
    for (const text of chunks) yield { type: 'text-delta', text };
  });
  getProvider.mockReturnValue({ stream, generate: vi.fn() });
}

beforeEach(() => {
  stream.mockReset();
  getProvider.mockReset();
});

describe('reporting files as they arrive', () => {
  it('names each file as its block begins', async () => {
    emits([
      'Here you go.\n\n// package.json\n```json\n{"name":"x"}\n```\n',
      '\n// app/page.tsx\n```tsx\nexport default function Page() { return null; }\n```\n',
    ]);

    const seen: string[] = [];
    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: () => undefined,
      onFile: (path) => {
        seen.push(path);
      },
    });

    expect(seen).toEqual(['package.json', 'app/page.tsx']);
    expect(result.files.map((file) => file.path)).toEqual(['package.json', 'app/page.tsx']);
  });

  /* A log that repeats itself is noise, and the buffer is re-read every chunk. */
  it('never names the same file twice', async () => {
    emits([
      '// app/page.tsx\n```tsx\nconst a = 1;\n',
      'const b = 2;\n```\n',
      '\n// lib/site.ts\n```ts\nexport const x = 1;\n```\n',
    ]);

    const seen: string[] = [];
    await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: () => undefined,
      onFile: (path) => {
        seen.push(path);
      },
    });

    expect(seen).toEqual(['app/page.tsx', 'lib/site.ts']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('produces the same files whether or not anyone is listening', async () => {
    const chunks = ['// a.ts\n```ts\nexport const a = 1;\n```\n'];

    emits(chunks);
    const withListener = await generateFiles({
      brief,
      prompt: 'x',
      model,
      report: () => undefined,
      onFile: () => undefined,
    });

    emits(chunks);
    const without = await generateFiles({
      brief,
      prompt: 'x',
      model,
      report: () => undefined,
    });

    expect(withListener.files).toEqual(without.files);
  });

  /* Prose that happens to contain a fence is not a file. */
  it('does not name a fenced block that has no path', async () => {
    emits(['Some explanation.\n\n```bash\nnpm install\n```\n']);

    const seen: string[] = [];
    await generateFiles({
      brief,
      prompt: 'x',
      model,
      report: () => undefined,
      onFile: (path) => {
        seen.push(path);
      },
    });

    expect(seen).toEqual([]);
  });
});
