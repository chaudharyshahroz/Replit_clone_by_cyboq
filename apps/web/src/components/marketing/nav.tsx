import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';

const LINKS = [
  { href: '/product', label: 'Product' },
  { href: '/research', label: 'Research' },
  { href: '/build', label: 'Build' },
  { href: '/skills', label: 'Skills' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/80 backdrop-blur-xl">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
      >
        <Link href="/" className="rounded-md" aria-label="Reklu home">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup" variant="primary" size="sm">
            Get started
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}
