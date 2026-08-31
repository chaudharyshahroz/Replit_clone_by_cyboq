import { describe, expect, it } from 'vitest';
import { parseVisualReview, visualRevisionPrompt } from '../visual-review';

describe('rendered visual review', () => {
  it('normalizes a reviewer response and requires the passing threshold', () => {
    expect(
      parseVisualReview('```json\n{"score":74,"verdict":"pass","summary":"Close","findings":["Reduce the empty hero height"]}\n```'),
    ).toEqual({
      score: 74,
      verdict: 'revise',
      summary: 'Close',
      findings: ['Reduce the empty hero height'],
    });
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
});
