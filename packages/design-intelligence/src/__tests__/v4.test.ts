import { describe, it, expect } from 'vitest';
import {
  createDesignEngineV4,
  compileDesignStyles,
  DesignEngineV4Schema,
  understandProduct,
  evaluatePremiumGate,
  DESIGN_VIEWPORTS,
} from '../index';

const cases = [
  [
    'Coffino',
    "Let's build a landing page for my business that is coffe shop. Coffino is the name. Make sure design full website include all pages and section and also include online shop function etc",
    'restaurant',
  ],
  ['Forma', 'Premium gym with membership shop', 'fitness'],
  ['Cipher', 'AI cybersecurity startup SaaS', 'saas'],
  ['Alba', 'Luxury restaurant', 'restaurant'],
  ['Vela', 'Fashion brand online store', 'fashion'],
  ['Orbit', 'Developer API platform', 'developer_tool'],
  ['Ledger', 'Financial analytics SaaS', 'fintech'],
  ['Mira', 'Photographer portfolio', 'portfolio'],
] as const;

describe('V4 category regression matrix', () => {
  it.each(cases)(
    '%s preserves industry intent before choosing a composition',
    (product, summary, category) => {
      const context = understandProduct({ product, summary, target: 'website' });
      expect(context.productType).toBe(category);
      const engine = createDesignEngineV4(context);
      expect(DesignEngineV4Schema.parse(engine)).toEqual(engine);
      expect(engine.selection.method).toBe('curated-rules');
      expect(compileDesignStyles(engine)).not.toContain('10vw');
      expect(compileDesignStyles(engine)).toContain('--color-on-primary:');
      expect(compileDesignStyles(engine)).toContain('minmax(min(100%, 240px), 1fr)');
    },
  );

  it('differentiates colors, typography and hero composition across industries', () => {
    const engines = cases.map(([product, summary]) =>
      createDesignEngineV4(understandProduct({ product, summary, target: 'website' })),
    );
    expect(new Set(engines.map((e) => e.dna.colors.primary)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(engines.map((e) => e.dna.typography.display)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(engines.map((e) => e.storyboard[0]?.composition)).size).toBeGreaterThanOrEqual(
      7,
    );
  });
});

describe('premium gate', () => {
  const renders = DESIGN_VIEWPORTS.map((width) => ({
    width,
    fullPage: true,
    score: 90,
    criticalFindings: [] as string[],
  }));
  const complete = { renders, assets: [], assetsAudited: true, interactionsVerified: true };
  it('requires evidence, not merely an HTTP-successful preview', () => {
    expect(
      evaluatePremiumGate({
        renders: [],
        assets: [],
        assetsAudited: false,
        interactionsVerified: false,
      }).status,
    ).toBe('pending');
    expect(evaluatePremiumGate(complete).status).toBe('approved');
    expect(
      evaluatePremiumGate({ ...complete, renders: renders.map((r) => ({ ...r, fullPage: false })) })
        .status,
    ).toBe('pending');
  });
  it('blocks broken media and defers loaded but semantically unverified assets', () => {
    const asset = {
      id: 'hero',
      critical: true,
      status: 'loaded' as const,
      naturalWidth: 1200,
      naturalHeight: 800,
      relevance: 'unverified' as const,
    };
    expect(evaluatePremiumGate({ ...complete, assets: [asset] }).status).toBe('pending');
    expect(
      evaluatePremiumGate({ ...complete, assets: [{ ...asset, status: 'failed' }] }).status,
    ).toBe('needs_revision');
    expect(
      evaluatePremiumGate({ ...complete, assets: [{ ...asset, relevance: 'verified' }] }).status,
    ).toBe('approved');
  });
  it('critical failures override high scores', () => {
    expect(
      evaluatePremiumGate({
        ...complete,
        renders: [
          { width: 1440, fullPage: true, score: 99, criticalFindings: ['Unreadable heading'] },
        ],
      }).status,
    ).toBe('needs_revision');
  });
});
