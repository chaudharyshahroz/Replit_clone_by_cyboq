'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  Columns2,
  History,
  Home,
  Layers,
  MessageSquare,
  Plug,
  Settings,
  Telescope,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Wordmark } from '@/components/brand/logo';

/**
 * Spec §66. Not every feature belongs in the sidebar — Create is contextual.
 *
 * `available: false` renders an item as visibly unavailable rather than as a
 * link that goes nowhere. A disabled control that says why is honest; a live
 * link to a missing page is not (spec §137).
 */
interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly available: boolean;
}

const PRIMARY: readonly NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, available: true },
  { href: '/chat', label: 'Chat', icon: MessageSquare, available: true },
  { href: '/compare', label: 'Compare', icon: Columns2, available: true },
  { href: '/research', label: 'Research', icon: Telescope, available: true },
  { href: '/build', label: 'Build', icon: Wrench, available: true },
];

const LIBRARY: readonly NavItem[] = [
  { href: '/projects', label: 'Projects', icon: Layers, available: true },
  { href: '/artifacts', label: 'Artifacts', icon: Boxes, available: true },
];

const PLATFORM: readonly NavItem[] = [
  { href: '/skills', label: 'Skills', icon: Boxes, available: true },
  // Lives under Settings, where the OAuth flow and revoke controls are.
  { href: '/settings/connections', label: 'Connections', icon: Plug, available: true },
  { href: '/research/history', label: 'History', icon: History, available: true },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base =
    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors';

  if (!item.available) {
    return (
      <span
        aria-disabled="true"
        title="Not available in this build yet"
        className={`${base} cursor-not-allowed text-text-muted/60`}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{item.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-text-muted/50">
          Soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${
        active
          ? 'bg-surface-raised font-medium text-text'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Group({ items, pathname }: { items: readonly NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <NavLink item={item} active={pathname === item.href || pathname.startsWith(`${item.href}/`)} />
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({
  workspaceName,
  userName,
  userEmail,
}: {
  workspaceName: string;
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="px-4 py-4">
        <Link href="/home" className="inline-block rounded-md" aria-label="Reklu home">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Workspace" className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <Group items={PRIMARY} pathname={pathname} />

        <div>
          <h2 className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Library
          </h2>
          <Group items={LIBRARY} pathname={pathname} />
        </div>

        <div>
          <h2 className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Platform
          </h2>
          <Group items={PLATFORM} pathname={pathname} />
        </div>
      </nav>

      <div className="border-t border-border p-3">
        <p className="px-2.5 pb-2 text-[11px] uppercase tracking-wider text-text-muted">
          {workspaceName}
        </p>
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-text">{userName}</span>
            <span className="block truncate text-xs text-text-muted">{userEmail}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
