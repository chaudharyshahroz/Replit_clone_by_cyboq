import { describe, expect, it } from 'vitest';
import { locatePassage, significantTerms } from '../passages';

describe('significantTerms', () => {
  it('drops stop words and short tokens', () => {
    expect(significantTerms('The revenue of the company is in the report')).toEqual([
      'revenue',
      'company',
      'report',
    ]);
  });

  it('de-duplicates', () => {
    expect(significantTerms('revenue revenue revenue')).toEqual(['revenue']);
  });

  it('returns nothing for a claim made only of stop words', () => {
    expect(significantTerms('it is on the')).toEqual([]);
  });
});

describe('locatePassage', () => {
  const article = [
    'Introduction to the annual report. This section is general background material.',
    '',
    'Our headcount grew steadily through the period across all regions.',
    '',
    'Revenue for the fourth quarter reached 4.2 million pounds, driven by enterprise renewals.',
    '',
    'The outlook section discusses currency exposure and hedging arrangements.',
  ].join('\n');

  // Guard the fixture: with a window larger than the source the whole document
  // is one window, and offset 0 would win for the wrong reason.
  it('fixture is longer than the window used below', () => {
    expect(article.length).toBeGreaterThan(120);
  });

  it('finds the span containing the claim, not the opening paragraph', () => {
    const located = locatePassage('Revenue reached 4.2 million pounds', article, {
      windowChars: 120,
    });
    expect(located).toBeDefined();
    expect(located!.passage).toContain('4.2 million');
    // The bug this replaces: returning the document's opening regardless.
    expect(located!.passage.startsWith('Introduction')).toBe(false);
  });

  it('reports the offset into the source', () => {
    const located = locatePassage('enterprise renewals', article, { windowChars: 120 })!;
    expect(article.slice(located.offset)).toContain('enterprise renewals');
  });

  it('reports overlap as a fraction', () => {
    const located = locatePassage('headcount grew steadily', article, { windowChars: 120 })!;
    expect(located.overlap).toBeGreaterThan(0.5);
    expect(located.overlap).toBeLessThanOrEqual(1);
  });

  /**
   * The property that matters most: a passage that does not support the claim
   * is worse than no passage, because it looks like evidence.
   */
  it('returns undefined when nothing meaningfully overlaps', () => {
    expect(locatePassage('quantum entanglement in superconductors', article)).toBeUndefined();
  });

  it('respects a custom minimum overlap', () => {
    // A window small enough that no single span contains every claim term.
    expect(
      locatePassage('currency headcount renewals', article, {
        windowChars: 80,
        minOverlap: 0.99,
      }),
    ).toBeUndefined();
    expect(
      locatePassage('currency hedging', article, { windowChars: 80, minOverlap: 0.1 }),
    ).toBeDefined();
  });

  it('returns undefined for an empty source', () => {
    expect(locatePassage('any claim here', '')).toBeUndefined();
  });

  it('returns undefined for a claim with no significant terms', () => {
    expect(locatePassage('it is on the', article)).toBeUndefined();
  });

  it('ends the passage at a sentence boundary where possible', () => {
    const located = locatePassage('Revenue fourth quarter enterprise', article, {
      windowChars: 200,
    })!;
    expect(/[.!?]$/.test(located.passage.trim())).toBe(true);
  });

  it('caps passage length to the window', () => {
    const long = 'Revenue grew. '.repeat(500);
    const located = locatePassage('Revenue grew', long, { windowChars: 300 })!;
    expect(located.passage.length).toBeLessThanOrEqual(300);
  });

  it('handles a source with no sentence punctuation', () => {
    const noPunctuation = 'revenue grew significantly across every region and product line';
    expect(locatePassage('revenue grew', noPunctuation)).toBeDefined();
  });

  // A long source must not make this quadratic.
  it('stays fast on a large source', () => {
    const large = 'Filler sentence about unrelated topics. '.repeat(5_000) +
      'The decisive fact is that revenue reached 4.2 million pounds.';
    const started = Date.now();
    const located = locatePassage('revenue reached 4.2 million pounds', large);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(located?.passage).toContain('4.2 million');
  });
});
