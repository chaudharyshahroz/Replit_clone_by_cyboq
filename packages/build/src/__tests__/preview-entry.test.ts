import { describe, expect, it } from 'vitest';
import { previewEntryProblem, previewHealthCheck } from '../preview-entry';
import type { GeneratedFile } from '../parse';

const file = (path: string, content = ''): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('.json') ? 'json' : 'tsx',
});

const manifest = (dependencies: Record<string, string>) =>
  file('package.json', JSON.stringify({ dependencies }));

describe('preview entry validation', () => {
  it('rejects a tree with no root package manifest', () => {
    expect(previewEntryProblem([file('src/components/Hero.tsx')])).toContain('no root package.json');
  });

  it('rejects a Next tree made only of configuration and components', () => {
    expect(
      previewEntryProblem([
        manifest({ next: '14.2.5' }),
        file('src/components/Hero.tsx'),
      ]),
    ).toContain('no homepage');
  });

  it('accepts both supported Next app roots', () => {
    expect(previewEntryProblem([manifest({ next: '14.2.5' }), file('app/page.tsx')])).toBeUndefined();
    expect(
      previewEntryProblem([manifest({ next: '14.2.5' }), file('src/app/page.tsx')]),
    ).toBeUndefined();
  });

  it('accepts a Pages Router homepage', () => {
    expect(
      previewEntryProblem([manifest({ next: '14.2.5' }), file('src/pages/index.tsx')]),
    ).toBeUndefined();
  });

  it('requires the real entry files for Vite and Expo', () => {
    expect(previewEntryProblem([manifest({ vite: '5.0.0' }), file('src/App.tsx')])).toContain(
      'index.html',
    );
    expect(previewEntryProblem([manifest({ expo: '51.0.0' }), file('components/Home.tsx')])).toContain(
      'web entry',
    );
    expect(
      previewEntryProblem([manifest({ expo: '51.0.0' }), file('app/index.tsx')]),
    ).toBeUndefined();
  });

  it('does not guess the entry convention of a custom API server', () => {
    expect(previewEntryProblem([manifest({ hono: '4.0.0' }), file('src/index.ts')])).toBeUndefined();
  });

  it('requires a successful page for visual frameworks but only a response for APIs', () => {
    expect(previewHealthCheck([manifest({ next: '14.2.5' }), file('app/page.tsx')])).toEqual({
      path: '/',
      requireOk: true,
    });
    expect(previewHealthCheck([manifest({ hono: '4.0.0' }), file('src/index.ts')])).toEqual({
      path: '/',
      requireOk: false,
    });
  });
});
