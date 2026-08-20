/**
 * Turning citation markers into openable links.
 *
 * The whole claim of Reklu's research is that you can check what a statement
 * rests on. A marker that cannot be opened is a claim of sourcing without the
 * means to verify it, so this transform is load-bearing — and the failure mode
 * that matters most is linking a marker to the wrong source, which would look
 * fine and mislead.
 */
import { describe, expect, it } from 'vitest';
import { linkCitations, type LinkableSource } from '../citations';

const sources: LinkableSource[] = [
  { index: 1, url: 'https://a.example/one' },
  { index: 2, url: 'https://b.example/two' },
];

describe('linkCitations', () => {
  it('links a marker to the source it names', () => {
    expect(linkCitations('Coffee is hot [1].', sources)).toBe(
      'Coffee is hot [1](https://a.example/one).',
    );
  });

  it('links each marker to its own source, not the first one', () => {
    const linked = linkCitations('A [1] and B [2].', sources);
    expect(linked).toContain('[1](https://a.example/one)');
    expect(linked).toContain('[2](https://b.example/two)');
  });

  it('keeps a grouped marker whole rather than splitting it', () => {
    expect(linkCitations('Both agree [1, 2].', sources)).toBe(
      'Both agree [1, 2](https://a.example/one).',
    );
  });

  /**
   * The dangerous case. A marker naming a source that was dropped must stay
   * inert — pointing it at some other source would read as verified and be
   * false.
   */
  it('leaves a marker alone when its source is missing', () => {
    expect(linkCitations('Unsupported [7].', sources)).toBe('Unsupported [7].');
  });

  it('leaves everything alone when there are no sources', () => {
    expect(linkCitations('Nothing [1] here.', [])).toBe('Nothing [1] here.');
  });

  /** Already-linked text must not be wrapped twice. */
  it('does not re-link a marker that is already a link', () => {
    const already = 'See [1](https://a.example/one).';
    expect(linkCitations(already, sources)).toBe(already);
  });

  it('does not mistake a markdown link for a citation', () => {
    const text = 'Read [the docs](https://c.example).';
    expect(linkCitations(text, sources)).toBe(text);
  });

  it('handles a report with no markers at all', () => {
    expect(linkCitations('Plain prose.', sources)).toBe('Plain prose.');
  });
});
