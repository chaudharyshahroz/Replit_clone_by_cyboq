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
  /**
   * The marker names its publication rather than showing a number. A
   * government statistics office and an SEO listicle are not equivalent
   * evidence, and "[1]" hides which one the claim rests on.
   */
  it('names the source on the marker itself', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} citations={sources} />);

    // Twice: once on the chip, once in the card it reveals.
    expect(screen.getAllByText('a.example').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /a\.example/ })).toBeDefined();
  });

  it('shows the headline and passage behind the marker', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} citations={sources} />);

    expect(screen.getByText('Ewallets dominate ecommerce')).toBeDefined();
    expect(screen.getByText(/Digital wallets handled/)).toBeDefined();
  });

  it('still links to the source itself', () => {
    render(<Markdown content={'Claim [1](https://a.example/one).'} citations={sources} />);
    expect(screen.getByRole('link', { name: /a\.example/ }).getAttribute('href')).toBe(
      'https://a.example/one',
    );
  });

  /** A group stays one word wide: the first source, then how many more. */
  it('counts the rest of a grouped marker rather than listing them', () => {
    render(<Markdown content={'Both [1, 2](https://a.example/one).'} citations={sources} />);
    expect(screen.getByText('+1')).toBeDefined();
  });

  /** A grouped marker previews the source its link actually goes to. */
  it('previews the first source of a grouped marker', () => {
    render(<Markdown content={'Both [1, 2](https://a.example/one).'} citations={sources} />);
    expect(screen.getByText('Ewallets dominate ecommerce')).toBeDefined();
  });

  /** Falls back to the number when there is no source to name. */
  it('keeps the bare number when the source is missing', () => {
    render(<Markdown content={'Claim [9](https://x.example).'} citations={sources} />);
    expect(screen.getByRole('link', { name: '9' })).toBeDefined();
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
