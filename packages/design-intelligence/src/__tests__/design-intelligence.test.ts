import { describe, expect, it } from 'vitest';
import {
  createDesignDNA,
  createInformationArchitecture,
  DesignDNASchema,
  shouldRefine,
  understandProduct,
  chooseBuildPath,
  createBuildPerformanceTimeline,
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
