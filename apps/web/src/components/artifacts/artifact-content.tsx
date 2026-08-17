import Image from 'next/image';
import { Download, Presentation } from 'lucide-react';
import { Markdown } from '@/components/chat/markdown';

interface Slide {
  readonly layout: string;
  readonly title: string;
  readonly bullets: readonly string[];
  readonly notes?: string;
}

interface DeckContent {
  readonly format?: string;
  readonly deck?: {
    readonly title: string;
    readonly subtitle?: string;
    readonly slides?: Slide[];
  };
}

/**
 * Render an artifact according to what it actually is.
 *
 * Before this, every artifact fell back to rendering `contentText` as Markdown.
 * For an image that meant showing the prompt and never the picture; for a deck
 * it meant a flat outline. Both stored the right data — the viewer simply never
 * looked at the type.
 */
export function ArtifactContent({
  type,
  contentText,
  content,
  storageKey,
  title,
}: {
  readonly type: string;
  readonly contentText: string | null;
  readonly content: unknown;
  readonly storageKey: string | null;
  readonly title: string;
}) {
  if (type === 'image' && storageKey) {
    return (
      <figure>
        {/*
          Unoptimised on purpose: the file route is authenticated, and Next's
          optimiser would fetch it as an anonymous client and get nothing.
        */}
        <Image
          src={`/api/files/${storageKey}`}
          alt={contentText ?? title}
          width={1024}
          height={1024}
          unoptimized
          className="h-auto w-full rounded-lg border border-border"
        />
        {contentText ? (
          <figcaption className="mt-3 text-xs leading-relaxed text-text-muted">
            {contentText}
          </figcaption>
        ) : null}
        <a
          href={`/api/files/${storageKey}`}
          download
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          Download
        </a>
      </figure>
    );
  }

  const deck = (content as DeckContent | null)?.deck;
  if (type === 'presentation' && deck?.slides?.length) {
    return (
      <div>
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Presentation className="h-3.5 w-3.5" strokeWidth={1.75} />
          {deck.slides.length} slides
        </p>

        <ol className="mt-4 space-y-3">
          {deck.slides.map((slide, index) => (
            <li
              key={`${slide.title}-${index}`}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <p className="text-[11px] uppercase tracking-wider text-text-muted">
                {index + 1} · {slide.layout.replace(/-/g, ' ')}
              </p>
              <h3 className="mt-1 text-sm font-medium text-text">{slide.title}</h3>

              {slide.bullets.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {slide.bullets.map((bullet) => (
                    <li key={bullet} className="text-sm leading-relaxed text-text-secondary">
                      {bullet}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* Presenter notes stay visually distinct from slide content. */}
              {slide.notes ? (
                <p className="mt-3 border-t border-border pt-2.5 text-xs leading-relaxed text-text-muted">
                  {slide.notes}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (contentText) return <Markdown content={contentText} />;

  if (storageKey) {
    return (
      <p className="text-sm text-text-secondary">
        This artifact is stored as a file.{' '}
        <a
          href={`/api/files/${storageKey}`}
          className="rounded text-accent hover:text-accent-hover"
        >
          Download it
        </a>
        .
      </p>
    );
  }

  return <p className="text-sm text-text-muted">This version has no content.</p>;
}
