import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

/**
 * Only destinations that exist.
 *
 * This previously listed Overview, Integrations, Enterprise, Security, About,
 * Pricing, Terms and Privacy — every one a 404 — plus Research, Build and
 * Skills, which are app routes that bounce a logged-out visitor to sign-in.
 * Twelve of thirteen footer links went nowhere. `verify:links` now fails the
 * build if a marketing link stops resolving.
 */
const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '#how', label: 'How it works' },
      { href: '#features', label: 'Features' },
      { href: '#why', label: 'Why Reklu' },
    ],
  },
  {
    heading: 'Get started',
    links: [
      { href: '/signup', label: 'Create account' },
      { href: '/login', label: 'Sign in' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
              One AI workspace. Every model. Every tool. From idea to execution.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-labelledby={`footer-${column.heading}`}>
              <h2
                id={`footer-${column.heading}`}
                className="text-xs font-medium uppercase tracking-widest text-text-muted"
              >
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => {
                  // Fragments use a native anchor; routes use next/link.
                  // See the note in nav.tsx.
                  const Tag = link.href.startsWith('#') ? 'a' : Link;
                  return (
                    <li key={link.href}>
                      <Tag
                        href={link.href}
                        className="rounded text-sm text-text-secondary transition-colors hover:text-text"
                      >
                        {link.label}
                      </Tag>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
          <p className="text-sm text-text-muted">
            © {new Date().getFullYear()} Reklu. All rights reserved.
          </p>
          <p className="text-sm text-text-muted">Built for people who work with AI.</p>
        </div>
      </div>
    </footer>
  );
}
