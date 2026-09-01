/**
 * Researching a trade before building for it.
 *
 * Asked for a coffee shop landing page, a model writes the coffee shop landing
 * page it has always written: hero, three cards, a form. It does not know what
 * the good ones in that trade actually do. So the brief is researched first,
 * and what comes back is a plan — pages, sections in order, a direction for how
 * the thing should feel — rather than prose somebody has to act on.
 */
import { describe, expect, it } from 'vitest';
import { planToPrompt, researchQuestion, SitePlanSchema } from '../market-research';
import type { BuildBrief } from '../brief';

const brief = {
  product: 'a neighbourhood coffee shop',
  summary: 'A cafe that roasts its own beans and serves breakfast.',
  target: 'website',
  platforms: [],
  userRoles: [],
  coreFeatures: ['menu', 'opening hours'],
  pages: [],
  dataModel: [],
  stack: [],
  integrations: [],
  needsAuth: false,
  needsDatabase: false,
  outOfScope: [],
} as BuildBrief;

describe('what gets researched', () => {
  it('asks about the trade, not about the business', () => {
    /*
     * Searching for one business returns that business. Searching for what its
     * kind of site is expected to contain returns the convention, which is what
     * a plan can be built from.
     */
    const question = researchQuestion(brief);

    expect(question).toContain('a neighbourhood coffee shop');
    expect(question).toMatch(/pages|sections/);
    expect(question).toMatch(/weaknesses|opportunity/);
  });
});

describe('the plan a build is given', () => {
  const plan = SitePlanSchema.parse({
    audience: {
      primary: 'people choosing a nearby cafe for today',
      intent: 'confirm the menu, atmosphere, location and opening hours quickly',
      objections: ['unclear prices', 'not knowing whether there is seating'],
    },
    conventions: ['a menu people can read on the page'],
    competitorPatterns: ['strong sites expose hours and location before the brand story'],
    differentiators: ['most bury opening hours in a footer'],
    pages: [
      {
        path: '/',
        name: 'Home',
        purpose: 'Convince a passer-by to visit today',
        sections: ['Hero with the shop itself', 'Todays hours and location', 'Signature drinks'],
      },
      {
        path: '/menu',
        name: 'Menu',
        purpose: 'Answer what is served and what it costs',
        sections: ['Coffee', 'Food'],
      },
    ],
    theme: {
      mood: 'warm and unhurried',
      palette: 'roasted browns against off-white',
      typography: 'a humanist serif for headings',
      imagery: 'photographs of the room and the coffee, never stock smiles',
      shape: 'warm editorial crops with crisp menu typography',
      density: 'spacious marketing pages and compact menus',
      motion: 'subtle image reveals only',
    },
    conversion: {
      primaryAction: 'Get directions',
      supportingActions: ['Read the menu'],
      proof: ['house-roasted beans', 'today’s opening hours'],
    },
  });

  it('reads as instructions, with the sections in order', () => {
    const prompt = planToPrompt(plan);

    expect(prompt).toContain('/menu');
    expect(prompt).toContain('1. Hero with the shop itself');
    expect(prompt).toContain('2. Todays hours and location');
    /* The order is the point: a visitor needs hours before they need a story. */
    expect(prompt.indexOf('Hero with the shop')).toBeLessThan(prompt.indexOf('Signature drinks'));
  });

  it('carries the feel without pretending to choose colours', () => {
    const prompt = planToPrompt(plan);

    expect(prompt).toContain('warm and unhurried');
    expect(prompt).toContain('roasted browns');
    /* The build has its own design standards; what it needs here is direction. */
    expect(prompt).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('says where comparable sites are weak', () => {
    expect(planToPrompt(plan)).toContain('most bury opening hours in a footer');
  });

  it('turns audience, conversion and observed patterns into builder instructions', () => {
    const prompt = planToPrompt(plan);
    expect(prompt).toContain('people choosing a nearby cafe');
    expect(prompt).toContain('Primary conversion: Get directions');
    expect(prompt).toContain('strong sites expose hours');
    expect(prompt).toContain('primitive tokens');
    expect(prompt).toContain('semantic tokens');
  });
});

describe('the plan schema', () => {
  it('refuses a page with no sections', () => {
    /*
     * A page with no sections is not a plan, and would reach the generator as
     * an instruction to invent one — which is what this exists to replace.
     */
    expect(() =>
      SitePlanSchema.parse({
        pages: [{ path: '/', name: 'Home', purpose: 'x', sections: [] }],
        theme: { mood: 'a', palette: 'b', typography: 'c', imagery: 'd' },
      }),
    ).toThrow();
  });

  it('refuses a plan with no pages at all', () => {
    expect(() =>
      SitePlanSchema.parse({
        pages: [],
        theme: { mood: 'a', palette: 'b', typography: 'c', imagery: 'd' },
      }),
    ).toThrow();
  });
});
