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

/**
 * Pixabay's stated requirements, checked against the code that sends the
 * request — because every one of them fails silently. A query too long, a page
 * size below the minimum, an uncached repeat: none of them error in a way this
 * code sees. The search returns nothing, every picture falls through to the
 * generator, and the feature quietly does not work.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stock-images.ts', import.meta.url), 'utf8');

describe('the request Pixabay actually receives', () => {
  it('never exceeds the documented query length', () => {
    /* "This value may not exceed 100 characters." */
    const long = Array.from({ length: 40 }, () => 'extraordinarily').join(' ');
    expect(searchTerms(long).length).toBeLessThanOrEqual(100);
  });

  it('asks for a page size the API accepts', () => {
    // "Accepted values: 3 - 200" — one or two is rejected outright.
    const perPage = /'per_page', '(\d+)'/.exec(source)?.[1];
    expect(Number(perPage)).toBeGreaterThanOrEqual(3);
  });

  it('sends only orientations the API defines', () => {
    /* "all", "horizontal", "vertical" — anything else is an error. */
    const orientations = [...source.matchAll(/'(horizontal|vertical|all|square|landscape|portrait)'/g)]
      .map((match) => match[1]!);
    const sent = orientations.filter((value) =>
      ['horizontal', 'vertical', 'all'].includes(value),
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/'orientation', '(?!horizontal|vertical|all)/);
  });

  it('caches, as the API asks', () => {
    // "requests must be cached for 24 hours"
    expect(source).toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(source).toContain('remember(cacheKey');
  });

  it('downloads rather than hotlinks', () => {
    /*
     * "permanent hotlinking of images is not allowed... download them to your
     * server first." Storing is also what keeps an exported site working when
     * Pixabay's CDN is not.
     */
    expect(source).toContain('storage().put');
    /* The URL is fetched, and what is returned is our own key — never theirs. */
    expect(source).toMatch(/await fetch\(chosen/);
    expect(source).toMatch(/storageKey: key/);
  });
});
