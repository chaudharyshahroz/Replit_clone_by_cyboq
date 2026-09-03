import { describe, expect, it } from 'vitest';
import {
  createDesignDNA,
  createInformationArchitecture,
  DesignDNASchema,
  shouldRefine,
  understandProduct,
  chooseBuildPath,
  createBuildPerformanceTimeline,
  createDesignEngineV3,
  designEngineV3Prompt,
  designRecipeToCssVariables,
  DesignEngineV3Schema,
} from '../index';

describe('product understanding', () => {
  it('does not turn a restaurant into a SaaS landing page', () => {
    const context = understandProduct({
      product: 'North Star Restaurant',
      summary: 'A neighborhood restaurant with seasonal menus and reservations',
      target: 'website',
    });
    expect(context.productType).toBe('restaurant');
    expect(context.primaryCTA).toMatch(/reserve/i);
    expect(createInformationArchitecture(context).map((section) => section.id)).toEqual([
      'arrival', 'menu', 'visit',
    ]);
  });

  it('gives developer products code-first architecture', () => {
    const context = understandProduct({
      product: 'Orbit API', summary: 'Developer platform with SDKs and API docs', target: 'website',
    });
    expect(context.productType).toBe('developer_tool');
    expect(createInformationArchitecture(context)[1]?.patterns).toContain('quickstart steps');
  });
});

describe('build path routing', () => {
  it('keeps a simple marketing site off the agentic path', () => {
    const decision = chooseBuildPath({ target: 'website', needsAuth: false, needsDatabase: false, pages: [1, 2] });
    expect(decision.path).toBe('fast');
    expect(decision.deferUntilPreview).toContain('assets');
  });

  it('routes data-backed products to the agentic path', () => {
    expect(chooseBuildPath({ target: 'web_app', needsAuth: true, needsDatabase: true }).path).toBe('agentic');
  });
});

describe('performance timeline', () => {
  it('persists real elapsed milestones from a monotonic clock', async () => {
    const values = [100, 112, 149];
    const marks: unknown[] = [];
    const timeline = createBuildPerformanceTimeline((mark) => { marks.push(mark); }, () => values.shift() ?? 149, () => new Date('2026-09-02T00:00:00Z'));
    await timeline.mark('prompt_received');
    await timeline.mark('first_file');
    expect(marks).toEqual([
      { milestone: 'prompt_received', elapsedMs: 12, at: '2026-09-02T00:00:00.000Z' },
      { milestone: 'first_file', elapsedMs: 49, at: '2026-09-02T00:00:00.000Z' },
    ]);
  });
});

describe('persistent Design DNA', () => {
  it('produces a complete valid token system', () => {
    const context = understandProduct({ product: 'Ledger AI', summary: 'AI finance platform', target: 'website' });
    const dna = createDesignDNA(context);
    expect(DesignDNASchema.parse(dna)).toEqual(dna);
    expect(dna.directionId).toBe('precision-trust');
    expect(dna.dontRules).toContain('No wall of identical cards');
  });
});

describe('Design Engine V3', () => {
  it('recognizes fitness and selects from three genuinely distinct directions', () => {
    const context = understandProduct({
      product: 'Iron Forge',
      summary: 'A premium high-performance gym and coaching club',
      target: 'website',
    });
    const engine = createDesignEngineV3(context);

    expect(context.productType).toBe('fitness');
    expect(DesignEngineV3Schema.parse(engine)).toEqual(engine);
    expect(new Set(engine.candidates.map((candidate) => candidate.conceptName)).size).toBe(3);
    expect(new Set(engine.candidates.map((candidate) => candidate.layoutPersonality)).size).toBe(3);
    expect(engine.storyboard.sections.map((section) => section.id)).toContain('method');
    expect(engine.storyboard.sections.some((section) => /equal cards/i.test(section.composition))).toBe(true);
  });

  it('compiles semantic OKLCH, type, spacing, and reduced-motion tokens', () => {
    const engine = createDesignEngineV3(understandProduct({
      product: 'Iron Forge', summary: 'Performance fitness club', target: 'website',
    }));
    const css = designRecipeToCssVariables(engine.recipe);
    const prompt = designEngineV3Prompt(engine);

    expect(css).toContain('--color-background: oklch(');
    expect(css).toContain('--font-display:');
    expect(css).toContain('prefers-reduced-motion');
    expect(prompt).toContain('Never use emoji');
    expect(prompt).toContain('pageStoryboard');
    expect(prompt).toContain('Compiled token foundation');
  });

  it('produces visibly different recipes across the benchmark industries', () => {
    const prompts = [
      ['Iron Forge', 'premium performance gym'],
      ['Cipherwatch', 'AI cybersecurity developer API'],
      ['Osteria Alba', 'upscale Italian restaurant'],
      ['Vela', 'independent fashion label'],
      ['North Ledger', 'financial analytics SaaS'],
    ] as const;
    const engines = prompts.map(([product, summary]) =>
      createDesignEngineV3(understandProduct({ product, summary, target: 'website' })),
    );

    expect(new Set(engines.map((engine) => engine.selected.conceptName)).size).toBe(5);
    expect(new Set(engines.map((engine) => engine.recipe.typography.displayFont)).size)
      .toBeGreaterThanOrEqual(3);
    expect(new Set(engines.map((engine) => engine.recipe.heroTreatment)).size)
      .toBeGreaterThanOrEqual(4);
  });
});

describe('bounded refinement', () => {
  const evaluation = {
    overall: 72, hierarchy: 75, spacing: 70, typography: 80, consistency: 75,
    responsive: 65, accessibility: 82, originality: 68, conversion: 74,
    issues: [{ severity: 'high' as const, location: 'hero', problem: 'Crowded', suggestedFix: 'Reduce spacing', affectedFiles: [] }],
  };

  it('stops after the configured maximum', () => {
    expect(shouldRefine(evaluation, 0)).toBe(true);
    expect(shouldRefine(evaluation, 2)).toBe(false);
  });
});
