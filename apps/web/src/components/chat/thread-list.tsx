'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import type { ConversationSummary } from '@/lib/conversations';

/** Relative time that stays readable without pulling in a date library. */
function timeAgo(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ThreadList({ threads }: { threads: readonly ConversationSummary[] }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface/20">
      <div className="p-3">
        <Link
          href="/chat"
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-strong text-sm text-text transition-colors hover:bg-surface-hover"
        >
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
          New chat
        </Link>
      </div>

      {threads.length === 0 ? (
        // Spec §90 — say what this list will contain rather than showing nothing.
        <p className="px-4 py-6 text-xs leading-relaxed text-text-muted">
          Your chats appear here once you send a message.
        </p>
      ) : (
        <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-3">
          <ul className="space-y-0.5">
            {threads.map((thread) => {
              const href = `/chat/${thread.id}`;
              const active = pathname === href;
              return (
                <li key={thread.id}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-lg px-2.5 py-2 transition-colors ${
                      active
                        ? 'bg-surface-raised text-text'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    <span className="block truncate text-sm">{thread.title}</span>
                    <span className="mt-0.5 block text-[11px] text-text-muted">
                      {timeAgo(thread.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
