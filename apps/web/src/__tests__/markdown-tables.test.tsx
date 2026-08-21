/**
 * Tables, and headings that win against the text around them.
 *
 * A research answer is mostly dense bullets. Without a table a comparison
 * arrives as prose the reader has to hold in their head, and without heading
 * contrast a section title reads as one more sentence.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/chat/markdown';

const table = [
  '| Idea | Buyer | Why they pay |',
  '| --- | --- | --- |',
  '| Bid estimation | Contractors | Saves 40 hours a bid |',
  '| Freight quoting | Brokers | Speed wins loads |',
].join('\n');

describe('tables', () => {
  it('renders a markdown table as a table', () => {
    render(<Markdown content={table} />);

    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('puts the cells where they belong', () => {
    render(<Markdown content={table} />);

    expect(screen.getByRole('columnheader', { name: 'Buyer' })).toBeDefined();
    expect(screen.getByRole('cell', { name: 'Saves 40 hours a bid' })).toBeDefined();
  });

  it('renders inline markup inside cells', () => {
    render(
      <Markdown content={'| A |\n| --- |\n| **bold** |'} />,
    );
    expect(screen.getByRole('cell').querySelector('strong')).not.toBeNull();
  });

  /**
   * The separator row is the only unambiguous signal. A sentence containing a
   * pipe is prose, and treating it as a table would mangle it.
   */
  it('leaves a pipe in ordinary prose alone', () => {
    render(<Markdown content={'Use grep | wc to count matches.'} />);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('scrolls a wide table rather than widening the message', () => {
    const { container } = render(<Markdown content={table} />);
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
  });
});

describe('headings', () => {
  it('renders each level as its own element', () => {
    render(<Markdown content={'# One\n\n## Two\n\n### Three'} />);

    expect(screen.getByRole('heading', { level: 1, name: 'One' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Two' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: 'Three' })).toBeDefined();
  });

  /** A heading has to look different from the paragraph beneath it. */
  it('gives a heading more weight and size than body text', () => {
    render(<Markdown content={'## Section\n\nBody text here.'} />);
    const heading = screen.getByRole('heading', { level: 2 });

    expect([...heading.classList]).toContain('font-semibold');
    expect(heading.className).toMatch(/text-(xl|2xl)/);
  });
});

describe('structure in an ordinary reply', () => {
  /**
   * The same renderer serves chat and research, so a chat answer that uses
   * headings and tables gets the same treatment. What decides whether it does
   * is the system prompt, not this component — but if the rendering broke,
   * asking the model for structure would achieve nothing.
   */
  it('renders a chat answer with headings, a table and bold lead-ins', () => {
    const answer = [
      '## Recommended stack',
      '',
      '- **Frontend**: React and Next.js',
      '- **Backend**: Node or Python',
      '',
      '## Comparison',
      '',
      '| Option | Cost | Effort |',
      '| --- | --- | --- |',
      '| Hosted | Higher | Low |',
    ].join('\n');

    render(<Markdown content={answer} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Recommended stack' })).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByText('Frontend').tagName).toBe('STRONG');
  });
});
