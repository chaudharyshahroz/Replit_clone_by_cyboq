import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '/product', label: 'Overview' },
      { href: '/research', label: 'Research' },
      { href: '/build', label: 'Build' },
      { href: '/skills', label: 'Skills' },
      { href: '/integrations', label: 'Integrations' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/enterprise', label: 'Enterprise' },
      { href: '/security', label: 'Security' },
      { href: '/about', label: 'About' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
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
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded text-sm text-text-secondary transition-colors hover:text-text"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
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
