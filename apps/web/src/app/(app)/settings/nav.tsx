'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  CreditCard,
  Gauge,
  Plug,
  Server,
  SlidersHorizontal,
  User,
} from 'lucide-react';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

/**
 * Settings, grouped by what the setting belongs to.
 *
 * The split is not cosmetic: workspace settings affect everyone in the
 * workspace, account settings affect what the workspace is allowed to spend,
 * and user settings affect only the person reading them. Someone deciding
 * whether a change is safe to make needs to know which of the three they are
 * in before they touch anything.
 */
const GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/settings', label: 'Overview', icon: SlidersHorizontal },
      { href: '/settings/connections', label: 'Connections', icon: Plug },
      { href: '/settings/mcp', label: 'MCP servers', icon: Server },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings/usage', label: 'Usage', icon: Gauge },
      { href: '/settings/billing', label: 'Billing', icon: CreditCard },
    ],
  },
  {
    label: 'User',
    items: [{ href: '/settings/profile', label: 'Profile', icon: User }],
  },
];

/** Whether a nav entry owns the current route, including its sub-pages. */
function isActive(href: string, pathname: string): boolean {
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-xs font-medium text-text-muted">{group.label}</p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-surface-hover text-text'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
