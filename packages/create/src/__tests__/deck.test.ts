import { describe, expect, it } from 'vitest';
import {
  MAX_BULLETS_PER_SLIDE,
  MAX_SLIDES,
  deckToText,
  extractJson,
  parseDeck,
  renderDeckHtml,
} from '../deck';

const json = (value: unknown): string => JSON.stringify(value);

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  // Models fence JSON far more often than they return it bare.
  it('recovers from a fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers from an unlabelled fence', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  // "Here is your deck:" before the object is extremely common.
  it('recovers from a preamble', () => {
    expect(extractJson('Here is your deck:\n{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers when prose follows the object', () => {
    expect(extractJson('{"a":1}\n\nLet me know if you want changes.')).toEqual({ a: 1 });
  });

  it('returns undefined for text with no object', () => {
    expect(extractJson('I cannot help with that.')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(extractJson('{"a": }')).toBeUndefined();
  });
});

describe('parseDeck', () => {
  const valid = {
    title: 'Quarterly Review',
    subtitle: 'Q3 results',
    slides: [
      { layout: 'title', title: 'Q3 Review' },
      { layout: 'bullets', title: 'Highlights', bullets: ['Revenue up', 'Churn down'] },
    ],
  };

  it('parses a well-formed deck', () => {
    const deck = parseDeck(json(valid), 'Fallback')!;
    expect(deck.title).toBe('Quarterly Review');
    expect(deck.subtitle).toBe('Q3 results');
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1]?.bullets).toEqual(['Revenue up', 'Churn down']);
  });

  it('falls back to the supplied title when the model omits one', () => {
    expect(parseDeck(json({ slides: [{ title: 'One' }] }), 'My Deck')?.title).toBe('My Deck');
  });

  /** Models use several names for the same field; all of them mean bullets. */
  it.each([
    ['bullets', { title: 'A', bullets: ['x', 'y'] }],
    ['points', { title: 'A', points: ['x', 'y'] }],
    ['content array', { title: 'A', content: ['x', 'y'] }],
  ])('accepts %s', (_label, slide) => {
    expect(parseDeck(json({ slides: [slide] }), 'D')?.slides[0]?.bullets).toEqual(['x', 'y']);
  });

  it('splits a newline string into bullets', () => {
    const deck = parseDeck(json({ slides: [{ title: 'A', content: 'one\ntwo' }] }), 'D');
    expect(deck?.slides[0]?.bullets).toEqual(['one', 'two']);
  });

  it('strips list markers a model left in', () => {
    const deck = parseDeck(json({ slides: [{ title: 'A', bullets: ['- one', '• two'] }] }), 'D');
    expect(deck?.slides[0]?.bullets).toEqual(['one', 'two']);
  });

  it.each([
    ['heading instead of title', { heading: 'H', bullets: ['x'] }],
    ['speakerNotes instead of notes', { title: 'A', speakerNotes: 'say this' }],
  ])('accepts %s', (_label, slide) => {
    expect(parseDeck(json({ slides: [slide] }), 'D')?.slides).toHaveLength(1);
  });

  it('infers a layout when none is given', () => {
    const deck = parseDeck(
      json({ slides: [{ title: 'Cover' }, { title: 'Body', bullets: ['x'] }] }),
      'D',
    );
    expect(deck?.slides[0]?.layout).toBe('title');
    expect(deck?.slides[1]?.layout).toBe('bullets');
  });

  it('normalises a layout the model spelled differently', () => {
    const deck = parseDeck(json({ slides: [{ layout: 'TWO_COLUMN', title: 'A' }] }), 'D');
    expect(deck?.slides[0]?.layout).toBe('two-column');
  });

  it('ignores an unrecognised layout rather than failing', () => {
    const deck = parseDeck(json({ slides: [{ layout: 'carousel', title: 'A', bullets: ['x'] }] }), 'D');
    expect(deck?.slides[0]?.layout).toBe('bullets');
  });

  // A slide with neither a title nor content is not a slide.
  it('drops empty slides', () => {
    const deck = parseDeck(json({ slides: [{ title: 'Real' }, {}, { bullets: [] }] }), 'D');
    expect(deck?.slides).toHaveLength(1);
  });

  it('caps the deck length', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ title: `S${i}` }));
    expect(parseDeck(json({ slides: many }), 'D')?.slides).toHaveLength(MAX_SLIDES);
  });

  it('caps bullets per slide', () => {
    const bullets = Array.from({ length: 30 }, (_, i) => `b${i}`);
    const deck = parseDeck(json({ slides: [{ title: 'A', bullets }] }), 'D');
    expect(deck?.slides[0]?.bullets).toHaveLength(MAX_BULLETS_PER_SLIDE);
  });

  /**
   * A deck with no slides is a failure worth reporting, not an empty
   * presentation to open.
   */
  it.each([
    ['no slides key', json({ title: 'A' })],
    ['empty slides', json({ title: 'A', slides: [] })],
    ['only empty slides', json({ slides: [{}, {}] })],
    ['not JSON at all', 'I cannot make a deck about that.'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(parseDeck(raw, 'D')).toBeUndefined();
  });

  it('names untitled slides positionally rather than leaving them blank', () => {
    const deck = parseDeck(json({ slides: [{ bullets: ['x'] }] }), 'D');
    expect(deck?.slides[0]?.title).toBe('Slide 1');
  });
});

describe('renderDeckHtml', () => {
  const deck = parseDeck(
    json({
      title: 'Review',
      slides: [{ title: 'Highlights', bullets: ['Revenue up'], notes: 'mention hiring' }],
    }),
    'D',
  )!;

  it('produces a complete document', () => {
    const html = renderDeckHtml(deck);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('</html>');
  });

  it('includes the content', () => {
    const html = renderDeckHtml(deck);
    expect(html).toContain('Highlights');
    expect(html).toContain('Revenue up');
    expect(html).toContain('mention hiring');
  });

  /**
   * Deck content is model output. A slide titled `<script>` must render as
   * text, not execute — the file is opened in a browser.
   */
  it('escapes model output rather than trusting it as markup', () => {
    const hostile = parseDeck(
      json({
        title: '<script>alert(1)</script>',
        slides: [{ title: '<img src=x onerror=alert(1)>', bullets: ['" onmouseover="alert(1)'] }],
      }),
      'D',
    )!;
    const html = renderDeckHtml(hostile);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  /**
   * Self-contained on purpose: it works offline, as an email attachment, and
   * from a filesystem — and cannot phone home from wherever it ends up.
   */
  it('references nothing external', () => {
    const html = renderDeckHtml(deck);
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('includes print styles, so it can become a PDF', () => {
    expect(renderDeckHtml(deck)).toContain('@media print');
  });
});

describe('deckToText', () => {
  it('produces a searchable outline', () => {
    const deck = parseDeck(
      json({ title: 'Review', slides: [{ title: 'Highlights', bullets: ['Revenue up'] }] }),
      'D',
    )!;
    const text = deckToText(deck);

    expect(text).toContain('Review');
    expect(text).toContain('## Highlights');
    expect(text).toContain('- Revenue up');
    // No markup: this is what full-text search indexes.
    expect(text).not.toContain('<');
  });
});
