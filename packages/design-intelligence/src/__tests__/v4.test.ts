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
  ['Field Notes', 'Independent editorial magazine and newsletter', 'content'],
  ['Northline', 'Local plumbing and repair service', 'local_service'],
] as const;

describe('V4 category regression matrix', () => {
  it.each(cases)(
    '%s preserves industry intent before choosing a composition',
    (product, summary, category) => {
      const context = understandProduct({
        product,
        summary,
        target: 'website',
      });
      expect(context.productType).toBe(category);
      const engine = createDesignEngineV4(context);
      expect(DesignEngineV4Schema.parse(engine)).toEqual(engine);
      expect(engine.selection.method).toBe('curated-rules');
      expect(compileDesignStyles(engine)).not.toContain('10vw');
      expect(compileDesignStyles(engine)).toContain('--color-on-primary:');
      expect(compileDesignStyles(engine)).toContain('--color-on-inverse-muted:');
      expect(compileDesignStyles(engine)).toContain('.rk-surface-inverse');
      expect(compileDesignStyles(engine)).toContain('.rk-site-header');
      expect(compileDesignStyles(engine)).toContain('.rk-header-inner');
      expect(compileDesignStyles(engine)).toContain('.rk-card');
      expect(compileDesignStyles(engine)).toContain('.rk-button-secondary');
      expect(compileDesignStyles(engine)).toContain('.rk-hero:not(.rk-container)');
      expect(compileDesignStyles(engine)).toContain('minmax(24rem, .9fr)');
      expect(compileDesignStyles(engine)).toContain('word-break: normal !important');
      expect(compileDesignStyles(engine)).toContain('min-height: auto !important');
      expect(compileDesignStyles(engine)).toContain('.rk-hero > :last-child.rk-media');
      expect(compileDesignStyles(engine)).toContain('@media (max-width: 959px)');
      expect(compileDesignStyles(engine)).not.toContain('overflow-wrap: break-word');
      expect(compileDesignStyles(engine)).toContain('minmax(min(100%, 240px), 1fr)');
    },
  );

  it('differentiates colors, typography and hero composition across industries', () => {
    const engines = cases.map(([product, summary]) =>
      createDesignEngineV4(understandProduct({ product, summary, target: 'website' })),
    );
    expect(new Set(engines.map((e) => e.dna.colors.primary)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(engines.map((e) => e.dna.typography.display)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(engines.map((e) => e.storyboard[0]?.composition)).size).toBeGreaterThanOrEqual(
      7,
    );
  });

  it('creates stable but varied art direction within the same industry', () => {
    const context = understandProduct({
      product: 'Independent coffee house',
      summary: 'Neighbourhood cafe with a small online shop',
      target: 'website',
    });
    const engines = Array.from({ length: 24 }, (_, index) =>
      createDesignEngineV4(context, `restaurant-project-${index}`),
    );

    expect(new Set(engines.map((engine) => engine.selection.profile)).size).toBe(3);
    expect(new Set(engines.map((engine) => engine.dna.typography.display)).size).toBe(3);
    expect(new Set(engines.map((engine) => engine.dna.colors.primary)).size).toBe(3);
    expect(createDesignEngineV4(context, 'stable-project')).toEqual(
      createDesignEngineV4(context, 'stable-project'),
    );
  });

  it('migrates legacy V4 records with conservative schema defaults', () => {
    const current = createDesignEngineV4(
      understandProduct({
        product: 'Coffino',
        summary: 'Coffee shop',
        target: 'website',
      }),
    );
    const legacy = JSON.parse(JSON.stringify(current));
    delete legacy.revision;
    delete legacy.selection.componentStyle;
    delete legacy.selection.signature;

    expect(DesignEngineV4Schema.parse(legacy)).toMatchObject({
      revision: 1,
      selection: {
        componentStyle: 'editorial',
        signature: 'subject-led composition',
      },
    });
  });
});

describe('premium gate', () => {
  const renders = DESIGN_VIEWPORTS.map((width) => ({
    width,
    fullPage: true,
    score: 90,
    criticalFindings: [] as string[],
  }));
  const complete = {
    renders,
    assets: [],
    assetsAudited: true,
    interactionsVerified: true,
  };
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
      evaluatePremiumGate({
        ...complete,
        renders: renders.map((r) => ({ ...r, fullPage: false })),
      }).status,
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
      evaluatePremiumGate({
        ...complete,
        assets: [{ ...asset, status: 'failed' }],
      }).status,
    ).toBe('needs_revision');
    expect(
      evaluatePremiumGate({
        ...complete,
        assets: [{ ...asset, relevance: 'verified' }],
      }).status,
    ).toBe('approved');
  });
  it('critical failures override high scores', () => {
    expect(
      evaluatePremiumGate({
        ...complete,
        renders: [
          {
            width: 1440,
            fullPage: true,
            score: 99,
            criticalFindings: ['Unreadable heading'],
          },
        ],
      }).status,
    ).toBe('needs_revision');
  });
});
