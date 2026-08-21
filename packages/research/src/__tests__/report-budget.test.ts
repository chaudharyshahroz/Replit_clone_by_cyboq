/**
 * How much room the report gets, and that it never exceeds the model's own cap.
 *
 * Both halves matter. Too small and the model answers a "give me eight ideas"
 * question with eight one-line entries, because there is no room to explain any
 * of them — which is what research output actually looked like. Too large and
 * the provider refuses the request outright rather than shortening it, so the
 * whole run fails.
 */
import { describe, expect, it } from 'vitest';
import { REPORT_TOKENS } from '../pipeline';

describe('report budget', () => {
  it('gives quick mode only what a two-sentence answer needs', () => {
    expect(REPORT_TOKENS.quick).toBeLessThanOrEqual(1_000);
  });

  it('gives a full report room to explain rather than list', () => {
    // The previous ceiling was 3,000 and produced lists of one-liners.
    expect(REPORT_TOKENS.research).toBeGreaterThan(3_000);
  });

  it('gives deep mode more room than research', () => {
    expect(REPORT_TOKENS.deep).toBeGreaterThan(REPORT_TOKENS.research);
  });

  it('orders the modes by how much work each is asked to do', () => {
    expect(REPORT_TOKENS.quick).toBeLessThan(REPORT_TOKENS.research);
  });
});
