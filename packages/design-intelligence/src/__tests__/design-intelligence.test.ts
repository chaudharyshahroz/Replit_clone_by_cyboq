import { describe, expect, it } from 'vitest';
import {
  createDesignDNA,
  createInformationArchitecture,
  DesignDNASchema,
  shouldRefine,
  understandProduct,
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
