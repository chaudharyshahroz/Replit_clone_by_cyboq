/**
 * Turning alt text into a search.
 *
 * Alt text is written to be read aloud — "a barber trimming a beard with
 * clippers in a warm wood-panelled shop" — and a search engine does badly with
 * a sentence. It wants the nouns. Getting this wrong does not error; it returns
 * no results, every picture falls through to the generator, and the saving this
 * exists for silently never happens.
 */
import { describe, expect, it } from 'vitest';
import { searchTerms } from '../stock-images';

describe('building a search from a description', () => {
  it('keeps the nouns and drops the joining words', () => {
    expect(searchTerms('a barber trimming a beard with clippers in a warm shop')).toBe(
      'barber trimming beard clippers warm shop',
    );
  });

  it('drops words that describe the medium rather than the subject', () => {
    /*
     * "photograph" appears in nearly every alt text Reklu writes, and searching
     * for it matches pictures of cameras.
     */
    expect(searchTerms('a wide photograph of a sunlit coffee bar')).toBe('wide sunlit coffee bar');
  });

  it('caps the length', () => {
    // A long query returns nothing at all rather than something approximate.
    const long = 'a barber carefully trimming a customer beard with electric clippers inside a warm wood panelled traditional shop';
    expect(searchTerms(long).split(' ')).toHaveLength(6);
  });

  it('survives punctuation and case', () => {
    expect(searchTerms('A BARBER’S CHAIR, beside a window.')).toContain('barber');
  });

  it('gives nothing back when there is nothing to search for', () => {
    /* The caller treats an empty query as a miss, rather than searching for "". */
    expect(searchTerms('a of the in on')).toBe('');
    expect(searchTerms('')).toBe('');
  });
});
