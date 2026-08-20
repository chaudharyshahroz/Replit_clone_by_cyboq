/**
 * Ordered lists that keep counting.
 *
 * Models write a numbered idea, then indented bullets explaining it, then the
 * next number. Only consecutive matching lines form one list, so each number
 * opens a separate <ol> — and every <ol> restarts at one. A ten-item list
 * rendered as "1." ten times, which is what research output actually looked
 * like.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/chat/markdown';

/** The shape research answers actually take. */
const interrupted = [
  '1. First idea',
  '- Why: because',
  '- Target: someone',
  '2. Second idea',
  '- Why: also because',
  '3. Third idea',
].join('\n');

describe('ordered lists', () => {
  it('keeps the author numbering when bullets interrupt the list', () => {
    const { container } = render(<Markdown content={interrupted} />);
    const lists = [...container.querySelectorAll('ol')];

    expect(lists).toHaveLength(3);
    // The first needs no start attribute; the others must carry theirs.
    expect(lists[1]!.getAttribute('start')).toBe('2');
    expect(lists[2]!.getAttribute('start')).toBe('3');
  });

  it('leaves an uninterrupted list alone', () => {
    const { container } = render(
      <Markdown content={'1. One\n2. Two\n3. Three'} />,
    );
    const lists = [...container.querySelectorAll('ol')];

    expect(lists).toHaveLength(1);
    expect(lists[0]!.getAttribute('start')).toBeNull();
    expect(lists[0]!.querySelectorAll('li')).toHaveLength(3);
  });

  it('does not put a start attribute on bulleted lists', () => {
    const { container } = render(<Markdown content={'- a\n- b'} />);
    expect(container.querySelector('ul')!.getAttribute('start')).toBeNull();
  });
});

describe('citations', () => {
  /**
   * Class tokens, not substrings: `no-underline` contains "underline", so a
   * substring check passes on the pill and proves nothing.
   */
  const classesOf = (element: Element): string[] => [...element.classList];

  /** A numeric link is a footnote, and must not read as inline prose. */
  it('renders a numeric link as a pill, not an underlined link', () => {
    render(<Markdown content={'Claim [1](https://a.example).'} />);
    const link = screen.getByRole('link', { name: '1' });

    expect(classesOf(link)).toContain('align-super');
    expect(classesOf(link)).toContain('no-underline');
    expect(classesOf(link)).not.toContain('underline');
  });

  it('still renders a worded link as ordinary prose', () => {
    render(<Markdown content={'Read [the docs](https://a.example).'} />);
    const link = screen.getByRole('link', { name: 'the docs' });

    expect(classesOf(link)).toContain('underline');
    expect(classesOf(link)).not.toContain('align-super');
  });
});
