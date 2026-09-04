import { describe, expect, it } from 'vitest';
import { createDesignEngineV4, understandProduct } from '@reklu/design-intelligence';
import { compileDesignTree } from '../design-compiler';
import { plannedArtwork } from '../artwork';
import type { GeneratedFile } from '../parse';

const engine = createDesignEngineV4(
  understandProduct({ product: 'Coffino', summary: 'Coffee shop', target: 'website' }),
);
describe('actual V4 compilation', () => {
  it.each(['src/', ''])('writes and imports the contract for %sapp', (prefix) => {
    const files: GeneratedFile[] = [
      {
        path: `${prefix}app/layout.tsx`,
        language: 'tsx',
        content: `'use client';\nimport './globals.css';\nexport default function Layout({children}){return <html><body>{children}</body></html>}`,
      },
    ];
    const compiled = compileDesignTree(files, engine);
    expect(compiled.find((f) => f.path === `${prefix}app/layout.tsx`)?.content).toContain(
      `import './globals.css';\nimport "./reklu-design.css";`,
    );
    expect(
      compiled.find((f) => f.path === `${prefix}components/reklu/BrandImage.tsx`)?.content,
    ).toContain('naturalWidth > 0');
    expect(compiled.find((f) => f.path === '.reklu/design-engine.json')).toBeDefined();
    expect(compileDesignTree(compiled, engine)).toEqual(compiled);
  });
  it('does not force a Next stylesheet onto imported frameworks', () => {
    const files = [{ path: 'index.html', content: '<h1>Hello</h1>', language: 'html' }];
    expect(compileDesignTree(files, engine)).toBe(files);
  });
  it('routes the media primitive into the real image fulfillment pipeline', () => {
    expect(
      plannedArtwork([
        {
          path: 'src/app/page.tsx',
          language: 'tsx',
          content:
            '<BrandImage src="/generated/coffee-hero.png" alt="Barista pouring a flat white at the cafe" role="critical" />',
        },
      ]),
    ).toEqual([
      {
        path: 'public/generated/coffee-hero.png',
        description: 'Barista pouring a flat white at the cafe',
        shape: 'landscape',
      },
    ]);
  });
});
