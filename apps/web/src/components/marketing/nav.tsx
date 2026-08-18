import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';

const LINKS = [
  /**
   * Every link points somewhere that exists.
   *
   * These previously went to /product, /pricing and the app's own /research and
   * /build — six 404s and three redirects to sign-in for anyone not logged in.
   * A nav that does not go where it says is the dead control the spec forbids
   * (§25), and it sat on the most-visited page in the product.
   */
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#why', label: 'Why Reklu' },
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
          {/*
            A plain <a>, not next/link: a jump within this page is not a
            navigation, and native anchor scrolling handles it without the
            client router. It honours scroll-mt-20 on each target, which is
            what stops the sticky header covering the heading.
          */}
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text"
              >
                {link.label}
              </a>
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
