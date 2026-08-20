'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CitedSource } from '@/lib/citations';

/**
 * The sources an answer rests on, kept beside it rather than buried under it.
 *
 * As a list at the end of a long report the sources are effectively hidden —
 * you have to finish reading and scroll past everything to find out what any
 * of it was based on. Docked, they stay in view while you read the claims they
 * support.
 *
 * Collapsible because on a narrow screen it becomes a header instead, and
 * because a reader who has already judged the sources should be able to put
 * them away.
 */
export function SourcesPanel({ sources }: { sources: readonly CitedSource[] }) {
  const [open, setOpen] = useState(true);

  if (sources.length === 0) return null;

  return (
    <aside
      aria-label="Sources"
      className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-text">Sources</span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums text-text-muted">{sources.length}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-muted transition-transform ${
              open ? '' : '-rotate-90'
            }`}
            strokeWidth={2}
          />
        </span>
      </button>

      {open ? (
        <ol className="max-h-[28rem] space-y-3 overflow-y-auto px-3.5 pb-3.5">
          {sources.map((source) => (
            <li key={source.index}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group block"
              >
                <span className="flex items-center gap-1.5 text-[0.7rem] text-text-muted">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${source.domain ?? ''}&sz=32`}
                    alt=""
                    width={12}
                    height={12}
                    className="h-3 w-3 rounded-sm"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                  <span className="truncate">{source.domain ?? 'source'}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{source.index}</span>
                </span>

                <span className="mt-1 line-clamp-2 block text-xs font-medium leading-snug text-text group-hover:text-accent">
                  {source.title}
                </span>

                {source.snippet ? (
                  <span className="mt-1 line-clamp-2 block text-[0.7rem] leading-relaxed text-text-muted">
                    {source.snippet}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
