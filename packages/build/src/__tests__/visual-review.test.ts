import { describe, expect, it } from 'vitest';
import { parseVisualReview, visualRevisionPrompt } from '../visual-review';

describe('rendered visual review', () => {
  it('normalizes a reviewer response and requires the passing threshold', () => {
    expect(
      parseVisualReview(
        '```json\n{"score":74,"verdict":"pass","summary":"Close","findings":["Reduce the empty hero height"]}\n```',
      ),
    ).toEqual({
      score: 74,
      verdict: 'revise',
      summary: 'Close',
      findings: ['Reduce the empty hero height'],
      criticalFindings: ['Reviewer did not explicitly evaluate critical defects.'],
    });
  });

  it('never averages a broken image away with a high score', () => {
    expect(
      parseVisualReview(
        JSON.stringify({
          score: 99,
          verdict: 'pass',
          findings: [],
          criticalFindings: ['Product photo is unrelated to the product'],
        }),
      ).verdict,
    ).toBe('revise');
    expect(
      parseVisualReview(
        JSON.stringify({ score: 90, verdict: 'pass', findings: [], criticalFindings: [] }),
      ).verdict,
    ).toBe('pass');
    expect(
      parseVisualReview(JSON.stringify({ score: 99, verdict: 'pass', findings: [] })).verdict,
    ).toBe('revise');
  });

  it('turns visible findings into a bounded presentation-only repair', () => {
    const prompt = visualRevisionPrompt({
      score: 40,
      verdict: 'revise',
      summary: 'Most content is below a blank first viewport.',
      findings: ['Remove the oversized empty hero region.'],
    });
    expect(prompt).toContain('Remove the oversized empty hero region.');
    expect(prompt).toContain('Preserve all routes, behavior, data flow');
  });

  it('keeps per-viewport scores for the responsive quality gate', () => {
    expect(
      parseVisualReview(JSON.stringify({
        score: 88,
        verdict: 'pass',
        summary: 'Responsive system is coherent.',
        findings: [],
        criticalFindings: [],
        viewportScores: { 1440: 91, 1024: 88, 768: 86, 430: 84, 390: 83 },
      })),
    ).toMatchObject({
      verdict: 'pass',
      viewportScores: { 1440: 91, 1024: 88, 768: 86, 430: 84, 390: 83 },
    });
  });
});
