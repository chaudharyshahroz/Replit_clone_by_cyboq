/**
 * Citations you can inspect, and sources you can see.
 *
 * The point of the research feature is that a claim can be checked. A marker
 * that shows nothing, or a source list nobody scrolls to, both fail that in a
 * way that still looks finished.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Markdown } from '@/components/chat/markdown';
import { SourcesPanel } from '@/components/chat/sources-panel';
import type { CitedSource } from '@/lib/citations';

const sources: CitedSource[] = [
  {
    index: 1,
    url: 'https://a.example/one',
    title: 'Ewallets dominate ecommerce',
    domain: 'a.example',
    snippet: 'Digital wallets handled most payments last year.',
  },
  {
    index: 2,
    url: 'https://b.example/two',
    title: 'Vertical SaaS gaps',
    domain: 'b.example',
    snippet: null,
  },
];

describe('citation markers', () => {
  it('shows what the marker points at', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} citations={sources} />);

    expect(screen.getByText('Ewallets dominate ecommerce')).toBeDefined();
    expect(screen.getByText('a.example')).toBeDefined();
    expect(screen.getByText(/Digital wallets handled/)).toBeDefined();
  });

  it('still links to the source itself', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} citations={sources} />);
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe(
      'https://a.example/one',
    );
  });

  /** A grouped marker previews the source its link actually goes to. */
  it('previews the first source of a grouped marker', () => {
    render(<Markdown content={'Both [1, 2](https://a.example/one).'} citations={sources} />);
    expect(screen.getByText('Ewallets dominate ecommerce')).toBeDefined();
  });

  /**
   * The case that must not invent anything: a marker whose source was dropped
   * during verification still renders, and shows no preview.
   */
  it('shows no preview for a marker with no matching source', () => {
    render(<Markdown content={'Claim [9](https://x.example).'} citations={sources} />);

    expect(screen.getByRole('link', { name: '9' })).toBeDefined();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders plain markdown when no citations are supplied', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('link', { name: '1' })).toBeDefined();
  });
});

describe('sources panel', () => {
  it('lists every source with its number and domain', () => {
    render(<SourcesPanel sources={sources} />);

    expect(screen.getByRole('link', { name: /Ewallets dominate/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /Vertical SaaS gaps/ })).toBeDefined();
    expect(screen.getByText('b.example')).toBeDefined();
  });

  it('collapses and reopens', async () => {
    const user = userEvent.setup();
    render(<SourcesPanel sources={sources} />);

    const toggle = screen.getByRole('button', { name: /Sources/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Ewallets dominate/ })).toBeNull();
  });

  /** Nothing to show is nothing to render — not an empty box. */
  it('renders nothing when there are no sources', () => {
    const { container } = render(<SourcesPanel sources={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
