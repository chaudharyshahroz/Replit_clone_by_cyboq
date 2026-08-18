import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { requireSuperAdmin } from '@/lib/admin';

/**
 * Admin shell.
 *
 * The gate runs here as well as on each page. A layout is not a security
 * boundary on its own — a page could be reached without it in some routing
 * arrangements — so both check, and neither relies on the other.
 */
const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/ai', label: 'AI' },
  { href: '/admin/system', label: 'System' },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin" className="flex items-center gap-2.5 rounded">
          <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="display text-lg text-text">Reklu admin</span>
        </Link>
        <span className="rounded border border-warning/40 bg-warning/5 px-2 py-1 text-[10px] uppercase tracking-wider text-warning">
          Every action here is logged
        </span>
      </header>

      <nav aria-label="Admin sections" className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-t-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <main className="mt-8">{children}</main>
    </div>
  );
}
