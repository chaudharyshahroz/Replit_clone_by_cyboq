'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowUp, Telescope, Wand2, Wrench } from 'lucide-react';

/**
 * The landing page composer.
 *
 * This is a real control, not a picture of one. It was previously a still
 * image with a comment explaining that a non-functional composer would be a
 * fake demo (spec §137) — which was right about the problem and wrong about
 * the fix. A working input that hands off honestly is better than an
 * illustration.
 *
 * What it deliberately does NOT do is answer. Streaming a canned reply on a
 * marketing page would be exactly the fake demo the spec forbids. Instead the
 * question is carried through sign-up and lands in the real composer, where a
 * real model answers it.
 *
 * The question arrives in the box rather than already sent: a new account's
 * first request should still be a deliberate act.
 */
const SUGGESTIONS = [
  {
    icon: Telescope,
    label: 'Research',
    query: 'Compare the three biggest AI note-taking apps on pricing and privacy.',
  },
  {
    icon: Wrench,
    label: 'Build',
    query: 'Build a booking page for a barber shop with opening hours and a contact form.',
  },
  {
    icon: Wand2,
    label: 'Create',
    query: 'Write a one-page launch brief for a productivity app aimed at freelancers.',
  },
] as const;

export function HeroComposer() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [going, setGoing] = useState(false);

  const go = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    setGoing(true);

    /**
     * Always through sign-up, which forwards an already-signed-in visitor
     * onward to the same destination.
     *
     * Checking the session here instead would mean reading a cookie on the
     * server, which turns this page from static into a database query on every
     * view — a real cost on the one page that should be fastest, to save a
     * signed-in visitor a single redirect.
     */
    const chat = `/chat?q=${encodeURIComponent(trimmed)}`;
    router.push(`/signup?next=${encodeURIComponent(chat)}`);
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go(query);
        }}
        className="group relative rounded-2xl border border-border-strong bg-surface shadow-2xl shadow-black/40 transition-colors focus-within:border-accent"
      >
        <label htmlFor="hero-query" className="sr-only">
          Ask Reklu anything
        </label>

        <textarea
          id="hero-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the same contract as
            // the real composer, so the habit transfers.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              go(query);
            }
          }}
          rows={3}
          maxLength={2000}
          placeholder="Ask anything, or describe what you want built…"
          className="w-full resize-none bg-transparent px-5 pb-14 pt-5 text-[0.9375rem] leading-relaxed text-text outline-none placeholder:text-text-muted"
        />

        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] text-text-muted">
            Free to start · no card needed
          </span>

          <button
            type="submit"
            disabled={query.trim().length === 0 || going}
            aria-label="Start with this question"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity hover:bg-accent-hover disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </form>

      {/*
        Real examples of the three things Reklu does, not decoration. Clicking
        one is the same action as typing it.
      */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          return (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => {
                setQuery(suggestion.query);
                go(suggestion.query);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:text-text"
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {suggestion.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
