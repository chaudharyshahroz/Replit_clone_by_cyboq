/**
 * Choosing the design for a product.
 *
 * The catalogue is only worth carrying if the right row comes back. These tests
 * assert on real rows rather than on shapes, so an upstream refresh that renames
 * a product type or drops a column fails here — loudly — instead of silently
 * changing what every generated site looks like.
 *
 * Two of them exist because of specific mis-matches found by running the
 * selection rather than reasoning about it: a coffee shop resolved to a generic
 * restaurant palette, and an analytics dashboard resolved to the smart-home one
 * because that row happens to list the plain word "analytics".
 */
import { describe, expect, it } from 'vitest';
import {
  chooseDirection,
  describeDirection,
  directionPrompt,
  matchLanding,
  isVisualTarget,
  matchProduct,
  matchStyle,
} from '../design-intelligence';
import { needsDesignPass } from '../design-pass';
import {
  FONT_PAIRINGS,
  LANDING_PATTERNS,
  PRODUCT_PROFILES,
  STYLE_PROFILES,
  UX_RULES,
} from '../design-data';
import type { BuildBrief, BuildTarget } from '../brief';

function brief(overrides: Partial<BuildBrief>): BuildBrief {
  return {
    product: 'Something',
    summary: 'A thing that does something',
    target: 'website',
    platforms: [],
    userRoles: [],
    coreFeatures: [],
    pages: [],
    dataModel: [],
    stack: [],
    integrations: [],
    needsAuth: false,
    needsDatabase: false,
    outOfScope: [],
    ...overrides,
  };
}

const TARGETS: readonly BuildTarget[] = ['website', 'web_app', 'mobile_app', 'api', 'dashboard'];

describe('the catalogue', () => {
  it('carries a complete palette for every product type', () => {
    expect(PRODUCT_PROFILES.length).toBeGreaterThan(150);

    for (const profile of PRODUCT_PROFILES) {
      /*
       * Every colour role filled with a value CSS will accept — a missing role
       * renders as an unstyled element rather than as an error. Hex covers
       * almost all of them; the dark palettes give `border` a translucent
       * white, which is correct and is not a hex value.
       */
      for (const [role, value] of Object.entries(profile.palette)) {
        if (role === 'notes') continue;
        expect(value, `${profile.type}.${role}`).toMatch(
          /^(#[0-9A-Fa-f]{6}|rgba?\([\d\s.,%]+\))$/,
        );
      }
    }
  });

  it('offers no pairing whose URL fails to load the families it names', () => {
    for (const pairing of FONT_PAIRINGS) {
      expect(pairing.googleFontsUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
      // The URL is passed to the model as the one it must use, so it has to
      // actually load the two families named beside it.
      const url = pairing.googleFontsUrl.replace(/\+/g, ' ');
      expect(url, pairing.name).toContain(pairing.heading);
      expect(url, pairing.name).toContain(pairing.body);
    }
  });

  it('keeps only rules that would fail a review', () => {
    expect(UX_RULES.length).toBeGreaterThan(20);
    for (const rule of UX_RULES) {
      expect(['Critical', 'High']).toContain(rule.severity);
      expect(rule.doThis.length).toBeGreaterThan(0);
    }
  });
});

describe('matching a product', () => {
  it('resolves a coffee shop to a cafe, not to generic food service', () => {
    const { profile, score } = matchProduct(
      brief({
        product: 'Brew & Bean coffee shop',
        summary: 'A neighbourhood coffee shop with a cafe menu and online ordering',
      }),
    );

    expect(profile.type).toBe('Bakery/Cafe');
    expect(score).toBeGreaterThan(0);
  });

  it('resolves an analytics dashboard by its name, not by a shared keyword', () => {
    /*
     * "Smart Home/IoT Dashboard" lists `analytics` and `dashboard` among its
     * keywords; "Analytics Dashboard" lists only kpi, cohort, attribution and
     * the like. Scoring keywords alone therefore sent every analytics brief to
     * the smart-home palette.
     */
    const { profile } = matchProduct(
      brief({
        product: 'Pulse analytics dashboard',
        summary: 'Realtime revenue and traffic analytics for ecommerce teams',
        target: 'dashboard',
      }),
    );

    expect(profile.type).toBe('Analytics Dashboard');
  });

  it('falls back to a real product type, and says that it did', () => {
    for (const target of TARGETS) {
      const direction = chooseDirection(
        brief({ product: 'Zzyzx', summary: 'qqqq wwww', target }),
      );

      // The fallback must name a row that exists; a typo here would have thrown
      // at generation time, on a customer's build.
      expect(PRODUCT_PROFILES.some((p) => p.type === direction.product.type)).toBe(true);
      expect(direction.matched).toBe(false);
      expect(describeDirection(direction)).toContain('default');
    }
  });
});

describe('resolving names across tables', () => {
  it('finds a style for every product recommendation', () => {
    /*
     * The tables do not share a vocabulary — products say "Minimalism", styles
     * say "Minimalism & Swiss Style" — so exact lookup silently returned
     * nothing for eleven product types.
     */
    const unresolved = PRODUCT_PROFILES.filter((profile) => !matchStyle(profile.primaryStyle));
    expect(unresolved.map((profile) => profile.primaryStyle)).toEqual([]);
  });

  it('finds a landing pattern for most product recommendations', () => {
    /*
     * Seventy-one profiles describe their pattern rather than naming one, so
     * this is matched on keywords. A handful genuinely describe something the
     * pattern table does not cover; those get no pattern rather than a wrong
     * one.
     */
    const resolved = PRODUCT_PROFILES.filter((profile) => matchLanding(profile.landingPattern));
    expect(resolved.length / PRODUCT_PROFILES.length).toBeGreaterThan(0.9);
  });

  it('resolves a compound recommendation to one of its parts', () => {
    expect(matchStyle('Glassmorphism + Flat Design')?.name).toBe('Glassmorphism');
    expect(matchStyle('Minimalism (Frame)')?.name).toBe('Minimalism & Swiss Style');
  });
});

describe('the prompt', () => {
  const direction = chooseDirection(
    brief({
      product: 'Brew & Bean coffee shop',
      summary: 'A neighbourhood coffee shop with a cafe menu',
      target: 'website',
    }),
  );

  const text = directionPrompt(direction, 'website');

  it('gives the model exact values rather than adjectives', () => {
    expect(text).toContain(direction.product.palette.primary);
    expect(text).toContain(direction.product.palette.accent);
    expect(text).toContain('--color-background');
    expect(text).toContain(direction.fonts?.googleFontsUrl ?? '');
  });

  it('says the section order is not a layout', () => {
    // The catalogue's commonest pattern is a hero and a row of feature cards,
    // which is the exact thing Reklu's own rules tell the model not to produce.
    // The prompt has to resolve that rather than state both.
    expect(text).toContain('It is not a layout');
    expect(text).toContain('do not render');
  });

  it('leaves charts out of a marketing site and puts them in a dashboard', () => {
    expect(text).not.toContain('Choosing a chart');

    const dash = chooseDirection(
      brief({ product: 'Ops dashboard', summary: 'Fleet metrics', target: 'dashboard' }),
    );
    expect(directionPrompt(dash, 'dashboard')).toContain('Choosing a chart');
  });

  it('gives a mobile build mobile rules and a web build web rules', () => {
    const mobile = chooseDirection(
      brief({ product: 'RepLog', summary: 'Workout logging', target: 'mobile_app' }),
    );
    expect(mobile.rules.every((rule) => rule.platform !== 'Web')).toBe(true);

    const web = chooseDirection(brief({ product: 'A site', target: 'website' }));
    expect(web.rules.every((rule) => rule.platform !== 'Mobile')).toBe(true);
  });

  it('stays small enough to sit in front of a generation', () => {
    // Roughly four characters to a token. This is prepended to every build, so
    // it competes with the code the model still has to write.
    for (const target of TARGETS) {
      const size = directionPrompt(chooseDirection(brief({ target })), target).length;
      expect(size, target).toBeLessThan(12_000);
    }
  });
});

describe('what the tables contain', () => {
  it('has the styles, fonts and patterns the data claims', () => {
    expect(STYLE_PROFILES.length).toBeGreaterThan(80);
    expect(FONT_PAIRINGS.length).toBeGreaterThan(60);
    expect(LANDING_PATTERNS.length).toBeGreaterThan(30);
  });
});

describe('briefs that are not shaped as the schema promises', () => {
  it('does not throw on a brief stored before a field existed', () => {
    /*
     * A brief is persisted as JSON and read back on a later deploy. The schema
     * defaults every list, but a row written before a field was added has no
     * such default, and spreading undefined threw inside generation — where the
     * failure reads as the model having gone wrong.
     */
    const legacy = {
      product: 'Old build',
      summary: 'Written before pages and integrations existed',
      target: 'website',
    } as unknown as BuildBrief;

    expect(() => chooseDirection(legacy)).not.toThrow();
    expect(chooseDirection(legacy).product.type).toBeTruthy();
  });
});

describe('targets that have nothing to look at', () => {
  it('gives an API no palette, and every visual target one', () => {
    /*
     * A background service has no pages. Sending it a palette and a font
     * pairing spends a thousand tokens of the generation's attention and tells
     * it something untrue about what it is building.
     */
    expect(isVisualTarget('api')).toBe(false);
    for (const target of ['website', 'web_app', 'dashboard', 'mobile_app'] as BuildTarget[]) {
      expect(isVisualTarget(target), target).toBe(true);
    }
  });

  it('agrees with the design pass about which targets are visual', () => {
    for (const target of TARGETS) {
      expect(needsDesignPass(target), target).toBe(isVisualTarget(target));
    }
  });
});

describe('briefs as people actually write them', () => {
  /**
   * Every case here was found by running the selection over real briefs, and
   * each one was wrong before the rule beneath it existed.
   */
  const cases: readonly [string, string, string][] = [
    // The user's own first build, misspelling included.
    [
      "Let's build a landing page for my business that is coffe shop. Coffino is the name",
      'Make sure design full website include all pages and section and also include online shop function',
      'Bakery/Cafe',
    ],
    ['Hartley & Cole law firm', 'Practice areas and attorney profiles', 'Legal Services'],
    ['Bloom florist', 'Order flowers online for delivery', 'Florist/Plant Shop'],
    ['My personal portfolio', 'Showcase my design work', 'Portfolio/Personal'],
    ['A blog about hiking', 'Articles and trip reports', 'Magazine/Blog'],
    ['Dr Patel dental clinic', 'Appointments and treatments', 'Healthcare App'],
  ];

  it.each(cases)('matches %s', (product, summary, expected) => {
    expect(matchProduct(brief({ product, summary })).profile.type).toBe(expected);
  });

  it('ignores words that describe the deliverable, not the subject', () => {
    /*
     * "landing" and "page" appear in exactly one of 192 product types, so the
     * frequency weighting gave them the highest score available: rare in the
     * catalogue and ubiquitous in briefs is the combination it gets backwards.
     *
     * The case that still depends on this is a brief naming no subject at all.
     * Left in, those words alone clear the threshold and assert Link-in-Bio
     * Page Builder as a considered choice; removed, the build gets a default
     * that admits to being one.
     */
    const direction = chooseDirection(
      brief({
        product: 'A landing page',
        summary: 'A full responsive website, modern design, all pages and sections',
      }),
    );

    expect(direction.matched).toBe(false);
    expect(direction.product.type).not.toBe('Link-in-Bio Page Builder');
  });

  it('forgives one typo in a word long enough to be sure about', () => {
    expect(matchProduct(brief({ product: 'coffe shop', summary: 'a coffe shop' })).profile.type)
      .toBe('Bakery/Cafe');

    // Two edits is a different word, and a confidently wrong palette is worse
    // than none: "cofe" could be anything.
    expect(matchProduct(brief({ product: 'zzzz', summary: 'cofe' })).matchScore ?? 0).toBe(0);
  });

  it('falls back rather than acting on one stray word', () => {
    /*
     * With the threshold off, "a barber shop" scored 1.06 against Gift &
     * Wishlist and "an online record store" 1.00 against Password Manager —
     * both on a single word. A default nobody chose is better than a palette
     * chosen for the wrong product.
     */
    const direction = chooseDirection(
      brief({ product: 'Vinyl Vault', summary: 'An online record store' }),
    );

    expect(direction.matched).toBe(false);
  });
});
