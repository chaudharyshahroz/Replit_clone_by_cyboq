import { describe, expect, it } from 'vitest';
import {
  extractClaimCitations,
  parseCitationMarkers,
  stripFabricatedCitations,
  validateCitations,
} from '../citations';

describe('parseCitationMarkers', () => {
  it('finds simple markers', () => {
    const markers = parseCitationMarkers('The market grew 40% [1] last year [2].');
    expect(markers.map((m) => m.index)).toEqual([1, 2]);
  });

  it('expands grouped markers', () => {
    expect(parseCitationMarkers('Several sources agree [1, 2, 3].').map((m) => m.index)).toEqual([
      1, 2, 3,
    ]);
  });

  // A markdown link is not a citation, and mistaking one would corrupt the prose.
  it('ignores markdown links', () => {
    expect(parseCitationMarkers('See [1](https://example.com) for detail.')).toEqual([]);
  });

  it('ignores checkboxes and non-numeric brackets', () => {
    expect(parseCitationMarkers('- [x] done\n- [ ] todo\n[note] here')).toEqual([]);
  });

  it('ignores zero, which is never a valid source number', () => {
    expect(parseCitationMarkers('Claim [0].')).toEqual([]);
  });

  it('records offsets', () => {
    const markers = parseCitationMarkers('abc [1]');
    expect(markers[0]!.offset).toBe(4);
  });

  it('returns nothing for prose with no citations', () => {
    expect(parseCitationMarkers('Just a sentence.')).toEqual([]);
  });
});

describe('validateCitations', () => {
  it('accepts markers within the retrieved set', () => {
    const result = validateCitations('Claim [1] and claim [3].', 5);
    expect(result.valid).toHaveLength(2);
    expect(result.fabricated).toHaveLength(0);
  });

  /**
   * The core failure this module exists to prevent: a model citing a source
   * that does not exist manufactures the appearance of evidence.
   */
  it('flags a citation beyond the retrieved set as fabricated', () => {
    const result = validateCitations('Confident claim [7].', 3);
    expect(result.fabricated).toHaveLength(1);
    expect(result.fabricated[0]!.index).toBe(7);
    expect(result.valid).toHaveLength(0);
  });

  it('treats every citation as fabricated when nothing was retrieved', () => {
    const result = validateCitations('Claim [1] and [2].', 0);
    expect(result.fabricated).toHaveLength(2);
  });

  it('reports sources that were retrieved but never cited', () => {
    expect(validateCitations('Only cites one [2].', 4).uncitedSourceIndexes).toEqual([1, 3, 4]);
  });

  it('flags a report that cited nothing despite having sources', () => {
    expect(validateCitations('No citations at all here.', 3).citedNothing).toBe(true);
  });

  it('does not flag citedNothing when there were no sources to cite', () => {
    expect(validateCitations('Nothing to cite.', 0).citedNothing).toBe(false);
  });

  it('handles a mixed valid/fabricated group', () => {
    const result = validateCitations('Sources say [1, 9].', 2);
    expect(result.valid.map((m) => m.index)).toEqual([1]);
    expect(result.fabricated.map((m) => m.index)).toEqual([9]);
  });
});

describe('stripFabricatedCitations', () => {
  it('removes out-of-range markers', () => {
    expect(stripFabricatedCitations('Claim [5].', 2)).toBe('Claim.');
  });

  it('keeps valid markers untouched', () => {
    expect(stripFabricatedCitations('Claim [2].', 3)).toBe('Claim [2].');
  });

  it('keeps the valid half of a mixed group', () => {
    expect(stripFabricatedCitations('Claim [1, 9].', 2)).toBe('Claim [1].');
  });

  it('tidies the space left before punctuation', () => {
    expect(stripFabricatedCitations('The market grew [9] .', 0)).toBe('The market grew.');
  });

  it('does not corrupt markdown links', () => {
    const text = 'See [1](https://example.com).';
    expect(stripFabricatedCitations(text, 0)).toBe(text);
  });

  it('leaves prose without citations alone', () => {
    expect(stripFabricatedCitations('Plain prose here.', 5)).toBe('Plain prose here.');
  });

  it('preserves list indentation', () => {
    const text = '- item one [1]\n- item two [9]';
    expect(stripFabricatedCitations(text, 1)).toBe('- item one [1]\n- item two');
  });

  it('strips everything when nothing was retrieved', () => {
    expect(stripFabricatedCitations('A [1] B [2] C [3].', 0)).toBe('A B C.');
  });
});

describe('extractClaimCitations', () => {
  it('pairs a marker with the sentence it supports', () => {
    const report = 'The market is growing. Revenue rose 40% last year [1]. Other things happened.';
    const claims = extractClaimCitations(report, 2);

    expect(claims).toHaveLength(1);
    expect(claims[0]!.sourceIndex).toBe(1);
    expect(claims[0]!.claim).toBe('Revenue rose 40% last year.');
  });

  it('strips the marker from the stored claim', () => {
    const claims = extractClaimCitations('Adoption doubled [2].', 3);
    expect(claims[0]!.claim).not.toContain('[2]');
  });

  it('handles a claim at the start of the report', () => {
    const claims = extractClaimCitations('First sentence with a cite [1].', 1);
    expect(claims[0]!.claim).toBe('First sentence with a cite.');
  });

  it('uses line boundaries inside lists', () => {
    const report = '- Point one [1]\n- Point two [2]';
    const claims = extractClaimCitations(report, 2);
    expect(claims[0]!.claim).toBe('- Point one');
    expect(claims[1]!.claim).toBe('- Point two');
  });

  it('records one entry per source in a group', () => {
    expect(extractClaimCitations('Both agree [1, 2].', 2)).toHaveLength(2);
  });

  // Fabricated markers must never produce a stored citation.
  it('excludes fabricated markers', () => {
    expect(extractClaimCitations('Claim [9].', 2)).toEqual([]);
  });
});
