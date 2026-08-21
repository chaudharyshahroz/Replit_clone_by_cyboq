import type { ReactNode } from 'react';
import Link from 'next/link';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { SettingsNav } from './nav';

/**
 * The shell every settings page renders inside.
 *
 * The nav lives here rather than on each page so the sections cannot drift
 * apart, and so a page can be added by creating a route and one nav entry.
 * Each page renders only its own content — the heading, the rail and the way
 * out are the shell's job.
 */
export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
        <h1 className="display flex items-center gap-2.5 text-xl text-text">
          <SettingsIcon className="h-5 w-5 text-text-secondary" strokeWidth={1.5} />
          Settings
        </h1>
        <Link
          href="/chat"
          aria-label="Close settings"
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      </header>

      {/*
        One scroll region, not three. The page already scrolls inside <main>,
        so the rail and the panel scroll with it — nesting another scrollport
        here would trap the wheel over whichever half the pointer happened to
        be on.
      */}
      <div className="flex flex-1 flex-col md:flex-row">
        <div className="shrink-0 border-b border-border p-3 md:w-60 md:border-b-0 md:border-r md:p-4">
          <SettingsNav />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
