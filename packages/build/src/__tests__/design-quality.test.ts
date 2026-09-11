import { describe, expect, it } from 'vitest';
import { fallbackBrief } from '../brief';
import { createDesignContract, designContractPrompt } from '../design-contract';
import {
  auditDesignQuality,
  designFeedbackPrompt,
  evaluateGenericity,
  genericityFindings,
  hydrationSafetyIssues,
} from '../design-quality';
import type { GeneratedFile } from '../parse';

const website = fallbackBrief('Build a marketing website for Coffino coffee shop');
const page = (content: string): GeneratedFile => ({
  path: 'src/app/page.tsx',
  content,
  language: 'tsx',
});
const v4 = (): GeneratedFile => ({
  path: '.reklu/design-engine.json',
  content: JSON.stringify({ version: 4 }),
  language: 'json',
});

describe('design contract', () => {
  it('requires a complete first viewport and representative preview content', () => {
    const prompt = designContractPrompt(createDesignContract(website)).toLowerCase();

    expect(prompt).toContain('first viewport');
    expect(prompt).toContain('realistic representative content');
    expect(prompt).toContain('no products');
    expect(prompt).toContain('primary action');
  });

  it('carries the strategist conversion decision into design review', () => {
    const prompt = designContractPrompt(
      createDesignContract(website, {
        conventions: [],
        competitorPatterns: [],
        differentiators: [],
        pages: [{ path: '/', name: 'Home', purpose: 'Convert', sections: ['Hero'] }],
        theme: {
          mood: 'warm',
          palette: 'earthy',
          typography: 'editorial',
          imagery: 'craft',
        },
        conversion: {
          primaryAction: 'Book a table',
          supportingActions: ['View menu'],
          proof: ['Open kitchen'],
        },
      }),
    );

    expect(prompt).toContain('Book a table');
    expect(prompt).toContain('Open kitchen');
  });
});

describe('design quality critic', () => {
  it('rejects the blank marketing shape shown in the preview', () => {
    const issues = auditDesignQuality(website, [
      page(
        'export default function Page(){return <main><nav>Coffino</nav><section className="min-h-screen" /></main>}',
      ),
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'missing-primary-heading',
        'missing-primary-action',
        'no-visual-media',
      ]),
    );
  });

  it('rejects raw product and testimonial empty states on a public site', () => {
    const issues = auditDesignQuality(website, [
      page(
        '<main><h1>Coffino</h1><p>No featured products yet</p><p>No testimonials yet</p><a href="/shop">Shop</a></main>',
      ),
    ]);

    expect(issues.some((issue) => issue.code === 'raw-marketing-empty-state')).toBe(true);
  });

  it('rejects utility markup when Tailwind is never loaded', () => {
    const issues = auditDesignQuality(website, [
      {
        path: 'package.json',
        content: JSON.stringify({ devDependencies: { tailwindcss: '^3.4.0' } }),
        language: 'json',
      },
      page(
        '<main className="flex min-h-screen"><h1>Barboa</h1><img src="/barber.jpg"/><a href="/book">Book</a></main>',
      ),
      {
        path: 'src/app/globals.css',
        content: 'body { margin: 0; }',
        language: 'css',
      },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'tailwind-not-loaded',
          severity: 'blocking',
        }),
      ]),
    );
  });

  it('accepts a composed marketing page with content, action and media', () => {
    const issues = auditDesignQuality(website, [
      page(
        '<main><h1>Roasted for slow mornings</h1><img src="/coffee.jpg" alt="Coffee"/><a href="/shop">Choose a roast</a></main>',
      ),
    ]);

    expect(issues).toEqual([]);
  });

  it('blocks heading rules and hero columns that split words on desktop', () => {
    const issues = auditDesignQuality(website, [
      v4(),
      page(
        '<main><section className="rk-hero"><div><h1 className="rk-hero-title">Coffee that slows you down</h1><a href="/book">Book</a></div><img src="/coffee.jpg" alt="Coffee"/></section></main>',
      ),
      {
        path: 'src/app/globals.css',
        content: '.hero-copy { max-width: 180px; } .rk-hero-title { overflow-wrap: anywhere; }',
        language: 'css',
      },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'destructive-heading-wrap',
          severity: 'blocking',
        }),
        expect.objectContaining({
          code: 'collapsed-hero-column',
          severity: 'blocking',
        }),
      ]),
    );
  });

  it('requires V4 pages to use the compiler-owned hero structure', () => {
    const issues = auditDesignQuality(website, [
      v4(),
      page(
        '<main><h1>Roasted for slow mornings</h1><img src="/coffee.jpg" alt="Coffee"/><a href="/shop">Shop</a></main>',
      ),
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-design-hero-contract',
          severity: 'blocking',
        }),
      ]),
    );
  });

  it('blocks raw headers, broken generated media paths and fake sold-out catalogues in V4', () => {
    const issues = auditDesignQuality(website, [
      v4(),
      page(`
        <header><a href="/">Coffino</a><nav>Shop</nav></header>
        <main><section className="rk-hero"><div><h1 className="rk-hero-title">Fresh coffee</h1><a href="/shop">Shop</a></div><img src="/generated/hero.png" alt="Coffee hero" /></section>
        <p>Sold out</p><p>Sold out</p><p>Sold out</p></main>
      `),
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-design-header-contract',
          severity: 'blocking',
        }),
        expect.objectContaining({
          code: 'unmanaged-generated-media',
          severity: 'blocking',
        }),
        expect.objectContaining({
          code: 'implausible-sold-out-catalogue',
          severity: 'blocking',
        }),
      ]),
    );
  });

  it('turns findings into explicit revision instructions', () => {
    const issues = auditDesignQuality(website, [page('<main />')]);
    const feedback = designFeedbackPrompt(issues);

    expect(feedback).toContain('[blocking] missing-primary-heading');
    expect(feedback).toContain('[blocking] missing-primary-action');
  });

  it('rejects emoji, generic copy and unsupported counters without condemning product grids', () => {
    const files = [
      page(`
      <main><h1>Everything You Need to Succeed</h1><img src="/gym.jpg" alt="Gym" />
      <a href="/join">Join</a><p>10K+ members</p><p>500+ classes</p><div>🔥</div>
      <Card/><Card/><Card/><Card/></main>
    `),
    ];
    const issues = auditDesignQuality(website, files);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'emoji-ui-icon',
          severity: 'blocking',
        }),
        expect.objectContaining({
          code: 'generic-marketing-copy',
          severity: 'blocking',
        }),
        expect.objectContaining({
          code: 'fabricated-vanity-counters',
          severity: 'blocking',
        }),
      ]),
    );
    expect(evaluateGenericity(files)).toMatchObject({ rejected: true });
    expect(evaluateGenericity(files).score).toBeGreaterThanOrEqual(35);
  });

  it('allows a useful repeated product grid', () => {
    const files = [
      page(
        '<h1>Small batch roasts</h1><img src="/beans.jpg" alt="Beans"/><a href="/shop">Shop</a><Card/><Card/><Card/><Card/>',
      ),
    ];
    expect(evaluateGenericity(files).rejected).toBe(false);
    expect(auditDesignQuality(website, files)).toEqual([]);
  });

  it('rejects nested card chrome and flags unearned bento composition', () => {
    const files = [
      v4(),
      page('<main><section className="rk-hero"><div><h1 className="rk-hero-title">Distinct coffee</h1><a href="/shop">Shop</a></div><img src="/coffee.jpg" alt="Coffee"/></section><div className="bento"><article className="rk-card"><div className="rk-card">Nested</div></article></div></main>'),
    ];
    expect(auditDesignQuality(website, files)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'nested-cards', severity: 'blocking' }),
      expect.objectContaining({ code: 'unearned-bento', severity: 'warning' }),
    ]));
  });

  it('blocks browser storage in a useState initializer before preview', () => {
    const provider = page(`
      'use client';
      import { useState } from 'react';
      export function CartProvider({ children }) {
        const [items] = useState(() => {
          const saved = window.localStorage.getItem('cart');
          return saved ? JSON.parse(saved) : [];
        });
        return <div data-count={items.length}>{children}</div>;
      }
    `);
    expect(hydrationSafetyIssues([provider])).toEqual([
      expect.objectContaining({
        code: 'non-deterministic-first-render',
        severity: 'blocking',
      }),
    ]);
  });

  it('allows storage to be read after hydration in an effect', () => {
    const provider = page(`
      'use client';
      import { useEffect, useState } from 'react';
      export function CartProvider({ children }) {
        const [items, setItems] = useState([]);
        useEffect(() => { setItems(JSON.parse(localStorage.getItem('cart') || '[]')); }, []);
        return <div data-count={items.length}>{children}</div>;
      }
    `);
    expect(hydrationSafetyIssues([provider])).toEqual([]);
  });
});

describe('a page that is generic without being faulty', () => {
  /**
   * The gap these cover was found by running both detectors over the same
   * files rather than by reading them.
   *
   * `evaluateGenericity` scored a page 45 out of 100, set `rejected`, and that
   * verdict went into the build analytics and nowhere else. Because no single
   * finding was blocking, the revision pass never ran: every section centred, a
   * stock gradient headline and eight radius values shipped exactly as written.
   *
   * And the gradient — the clearest tell that nobody decided how this product
   * should look — was known only to the detector that does not act, so it
   * survived every revision the critic ever ran.
   */
  const genericStyling = [
    page(
      [
        '<section className="text-center py-24">',
        '<h1 className="bg-gradient-to-r from-violet-500 to-blue-600 bg-clip-text text-transparent">',
        'Coffino roasts in Hackney every Tuesday</h1>',
        '<a href="/order">Order a bag</a>',
        '<img src="/generated/hero.png" alt="a barista pouring" width="1200" height="600" />',
        '</section>',
        '<section className="text-center py-24"><h2>Our Ethiopian single origin</h2></section>',
        '<section className="text-center py-24"><h2>Find us on Mare Street</h2></section>',
      ].join(''),
    ),
    {
      path: 'src/app/globals.css',
      content: [
        '@import "tailwindcss";',
        '.a{border-radius:2px} .b{border-radius:4px} .c{border-radius:6px} .d{border-radius:8px}',
        '.e{border-radius:10px} .f{border-radius:12px} .g{border-radius:16px} .h{border-radius:24px}',
      ].join('\n'),
      language: 'css',
    } satisfies GeneratedFile,
  ];

  it('has no blocking fault, which is why it used to ship untouched', () => {
    // The copy is specific and credible; there are no fabricated counters.
    // Nothing here is wrong on its own, and that was the problem.
    const blocking = auditDesignQuality(website, genericStyling).filter(
      (issue) => issue.severity === 'blocking',
    );
    expect(blocking).toEqual([]);
  });

  it('is nonetheless judged a template, and now says so in findings that act', () => {
    const report = evaluateGenericity(genericStyling);
    expect(report.rejected).toBe(true);

    const findings = genericityFindings(report);
    expect(findings.length).toBeGreaterThan(0);
    // Blocking, because the revision pass only reads blocking findings — the
    // reason to act is the accumulation, not any single choice.
    expect(findings.every((finding) => finding.severity === 'blocking')).toBe(true);
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['generic-gradient-treatment', 'repeated-centered-sections']),
    );
  });

  it('tells the acting critic about the stock gradient, not only the scorer', () => {
    expect(auditDesignQuality(website, genericStyling)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'generic-gradient-treatment' })]),
    );
  });

  it('leaves a page with a point of view alone', () => {
    /*
     * A revision costs a model call, so the bar has to separate "looks
     * machine-made" from "looks different to what I would have done".
     */
    const distinctive = [
      page(
        [
          '<section className="rk-hero grid md:grid-cols-[7fr_5fr] gap-12 py-28">',
          '<h1>Coffino roasts in Hackney every Tuesday</h1>',
          '<p>Bags ship the same afternoon. Collection from Mare Street until six.</p>',
          '<a href="/order">Order a bag</a>',
          '<img src="/generated/roastery.png" alt="a roaster tipping beans" width="720" height="900" />',
          '</section>',
          '<section className="py-24"><h2>The Ethiopian we cannot keep in stock</h2></section>',
          '<section className="py-24 md:flex md:gap-16"><h2>Where the beans come from</h2></section>',
        ].join(''),
      ),
      {
        path: 'src/app/globals.css',
        content: '@import "tailwindcss";\n.card{border-radius:12px} .pill{border-radius:999px}',
        language: 'css',
      } satisfies GeneratedFile,
    ];

    const report = evaluateGenericity(distinctive);
    expect(report.score).toBe(0);
    expect(genericityFindings(report)).toEqual([]);
    expect(auditDesignQuality(website, distinctive)).toEqual([]);
  });

  it('returns nothing for a page it did not reject, whatever it scored', () => {
    expect(genericityFindings({ score: 30, genericityIssues: [], rejected: false })).toEqual([]);
  });
});
