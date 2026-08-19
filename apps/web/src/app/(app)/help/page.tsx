import type { Metadata } from 'next';
import Link from 'next/link';
import { Columns2, Layers, MessageSquare, Plug, Sparkles, Wrench } from 'lucide-react';

export const metadata: Metadata = { title: 'Help' };

/**
 * What this page is not: a support form pointing at an address nobody reads.
 *
 * It documents what Reklu actually does and where each thing lives, plus the
 * shortcuts that are genuinely wired up. When a support channel exists, it
 * belongs here — inventing one now would send people somewhere that cannot
 * answer (spec §137).
 */
const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'Enter', action: 'Send the message' },
  { keys: 'Shift + Enter', action: 'Start a new line instead of sending' },
  { keys: 'Esc', action: 'Close a menu or dialog' },
];

const WHERE: readonly {
  icon: typeof MessageSquare;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}[] = [
  {
    icon: MessageSquare,
    title: 'Chat',
    body: 'Ask anything. Reklu Auto picks a model per request, or you can choose one yourself from the composer.',
    href: '/chat',
    linkLabel: 'Open chat',
  },
  {
    icon: Layers,
    title: 'Projects',
    body: 'A project keeps related chats, files and artifacts together, and carries standing instructions into every request inside it.',
    href: '/projects',
    linkLabel: 'Open projects',
  },
  {
    icon: Sparkles,
    title: 'Skills',
    body: 'Reusable instructions you invoke with @handle. Skills are versioned, so editing one never changes what a past run did.',
    href: '/skills',
    linkLabel: 'Open skills',
  },
  {
    icon: Plug,
    title: 'Connectors',
    body: 'Connect GitHub, Google and MCP servers. Every tool arrives switched off, and anything that changes data asks first.',
    href: '/settings/connections',
    linkLabel: 'Open connectors',
  },
  {
    icon: Columns2,
    title: 'Compare',
    body: 'Send one prompt to several models at once and read the answers side by side.',
    href: '/compare',
    linkLabel: 'Open compare',
  },
  {
    icon: Wrench,
    title: 'Research and Build',
    body: 'Research returns sources you can check. Build generates a project and runs it in an isolated sandbox — never on Reklu itself.',
    href: '/research',
    linkLabel: 'Open research',
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="display text-3xl text-text">Help</h1>
      <p className="mt-2 max-w-xl text-pretty text-text-secondary">
        What each part of Reklu does, and where to find it.
      </p>

      <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-text-muted">
        Around the workspace
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {WHERE.map((entry) => {
          const Icon = entry.icon;
          return (
            <li
              key={entry.href}
              className="rounded-xl border border-border bg-surface/40 p-5"
            >
              <h3 className="flex items-center gap-2 text-sm font-medium text-text">
                <Icon className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
                {entry.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{entry.body}</p>
              <Link
                href={entry.href}
                className="mt-3 inline-block text-sm text-accent hover:underline"
              >
                {entry.linkLabel}
              </Link>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-text-muted">
        Keyboard
      </h2>
      <dl className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface/40">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="flex items-center justify-between gap-4 px-5 py-3">
            <dt>
              <kbd className="rounded border border-border-strong bg-surface px-2 py-1 text-xs text-text">
                {shortcut.keys}
              </kbd>
            </dt>
            <dd className="text-sm text-text-secondary">{shortcut.action}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-12 text-sm font-medium uppercase tracking-wider text-text-muted">
        Your account
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-text-secondary">
        Your plan, usage and billing live in{' '}
        <Link href="/settings/billing" className="text-accent hover:underline">
          Settings → Billing
        </Link>
        . Sign-in methods and connected accounts are in{' '}
        <Link href="/settings" className="text-accent hover:underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}
