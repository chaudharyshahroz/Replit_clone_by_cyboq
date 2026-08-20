'use client';

import type { CitedSource } from '@/lib/citations';

/**
 * A citation marker with the source behind it.
 *
 * A number alone asks the reader to take the sourcing on trust and go hunting
 * to check it. Showing what the marker points at — publication, headline, the
 * passage it was drawn from — turns a footnote into something you can judge
 * without leaving the sentence.
 *
 * Hover and keyboard focus both open it, because a control only reachable by
 * mouse is not reachable by everyone.
 */
export function Citation({
  label,
  href,
  source,
}: {
  readonly label: string;
  readonly href: string;
  readonly source: CitedSource | undefined;
}) {
  /**
   * Named, not numbered.
   *
   * "[1]" tells the reader a claim is sourced and nothing about whether to
   * believe it. The publication is the part that carries weight — a government
   * statistics office and an SEO listicle are not the same evidence, and the
   * number hides which one you got.
   *
   * A grouped marker shows the first source and a count of the rest, so the
   * chip stays the width of a word rather than growing with the group.
   */
  const others = label.split(',').length - 1;

  const pill = source ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mx-0.5 inline-flex max-w-[12rem] -translate-y-px items-center gap-1 rounded border border-border-strong bg-surface-raised px-1.5 py-px align-baseline text-[0.75em] font-medium leading-tight text-text-secondary no-underline transition-colors hover:border-accent hover:text-accent"
    >
      <img
        src={`https://www.google.com/s2/favicons?domain=${source.domain ?? ''}&sz=32`}
        alt=""
        width={10}
        height={10}
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
      <span className="truncate">{source.domain ?? source.title}</span>
      {others > 0 ? <span className="shrink-0 text-text-muted">+{others}</span> : null}
    </a>
  ) : (
    /* No source to name, so the number is all there honestly is. */
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mx-0.5 inline-flex min-w-[1.15em] -translate-y-px items-center justify-center rounded border border-border-strong bg-surface-raised px-1 align-super text-[0.7em] font-medium leading-tight text-text-secondary no-underline transition-colors hover:border-accent hover:text-accent"
    >
      {label}
    </a>
  );

  // Nothing to preview when the marker names a source that was dropped.
  if (!source) return pill;

  return (
    <span className="group relative inline-block">
      {pill}

      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-72 -translate-x-1/2 rounded-xl border border-border-strong bg-surface-raised p-3 opacity-0 shadow-2xl shadow-black/50 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
      >
        <span className="flex items-center gap-1.5 text-[0.7rem] text-text-muted">
          {/*
            The favicon is fetched from the source's own origin. It fails
            silently to nothing rather than showing a broken-image icon.
          */}
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
          {source.domain ?? 'source'}
        </span>

        <span className="mt-1 block text-xs font-medium leading-snug text-text">
          {source.title}
        </span>

        {source.snippet ? (
          <span className="mt-1.5 line-clamp-3 block text-[0.7rem] leading-relaxed text-text-secondary">
            {source.snippet}
          </span>
        ) : null}
      </span>
    </span>
  );
}
