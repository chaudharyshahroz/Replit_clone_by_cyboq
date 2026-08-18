import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  Cpu,
  CreditCard,
  ExternalLink,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { requireSuperAdmin } from '@/lib/admin';

/**
 * Admin shell.
 *
 * Its own navigation, not the product's. An operator here is answering
 * different questions — who is using this, what is it costing, what broke —
 * and product navigation would only offer routes that do not exist on this
 * host.
 */
const SECTIONS = [
  { href: '/admin', label: 'Overview', icon: BarChart3 },
  { href: '/admin/analytics', label: 'Analytics', icon: Activity },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/billing', label: 'Billing', icon: CreditCard },
  { href: '/admin/ai', label: 'AI', icon: Cpu },
  { href: '/admin/system', label: 'System', icon: ShieldCheck },
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 py-5 md:flex">
        <Link href="/admin" className="mb-4 flex items-center gap-2 rounded px-2">
          <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} />
          <span className="display text-base text-text">Reklu admin</span>
        </Link>

        <nav aria-label="Admin sections" className="flex flex-col gap-0.5">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.href}
                href={section.href}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <p className="rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
            Every action here is written to the audit log.
          </p>
          {/*
            The product is a different host, so this is a full navigation
            rather than an in-app link.
          */}
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded px-2.5 text-xs text-text-muted hover:text-text"
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            Back to Reklu
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Section navigation on small screens, where the rail is hidden. */}
        <nav
          aria-label="Admin sections"
          className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden"
        >
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
