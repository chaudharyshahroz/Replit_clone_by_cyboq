/**
 * Presentation structure (spec §43).
 *
 * A deck is stored as data, not as rendered HTML: the same structure exports
 * to HTML, to a PDF, or to PPTX later, and an editor can change one slide
 * without reparsing a document.
 *
 * Models are asked for JSON and reliably return something *close* to it —
 * wrapped in prose, fenced, with a missing field, or with forty slides when
 * five were asked for. Everything here is about turning that into a deck a
 * person can actually open, rather than failing the whole generation because
 * one field was spelled differently.
 */
import { z } from 'zod';

export const MAX_SLIDES = 40;
export const MAX_BULLETS_PER_SLIDE = 8;

export type SlideLayout = 'title' | 'bullets' | 'quote' | 'statement' | 'two-column';

export interface Slide {
  readonly layout: SlideLayout;
  readonly title: string;
  readonly bullets: readonly string[];
  /** Shown under the slide in presenter view; never on the slide itself. */
  readonly notes?: string | undefined;
}

export interface Deck {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly slides: readonly Slide[];
}

const LAYOUTS: readonly SlideLayout[] = ['title', 'bullets', 'quote', 'statement', 'two-column'];

/** Tolerant of the shapes models actually produce. */
const slideSchema = z.object({
  layout: z.string().optional(),
  title: z.string().optional(),
  heading: z.string().optional(),
  bullets: z.array(z.unknown()).optional(),
  points: z.array(z.unknown()).optional(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
  notes: z.string().optional(),
  speakerNotes: z.string().optional(),
});

const deckSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  slides: z.array(slideSchema).optional(),
});

/** Recover a JSON object from a reply that may be fenced or prefaced. */
export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // A model that wrote a sentence before the object still produced an object.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function toBullets(slide: z.infer<typeof slideSchema>): string[] {
  const source =
    slide.bullets ??
    slide.points ??
    (Array.isArray(slide.content) ? slide.content : undefined) ??
    (typeof slide.content === 'string' ? slide.content.split('\n') : []);

  return source
    .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
    .map((entry) => entry.replace(/^[-*•]\s*/, '').trim())
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_BULLETS_PER_SLIDE);
}

function toLayout(raw: string | undefined, bulletCount: number, index: number): SlideLayout {
  const normalised = raw?.toLowerCase().replace(/[\s_]+/g, '-');
  if (normalised && (LAYOUTS as readonly string[]).includes(normalised)) {
    return normalised as SlideLayout;
  }
  // The first slide is the title slide unless it clearly has content.
  if (index === 0 && bulletCount === 0) return 'title';
  return bulletCount > 0 ? 'bullets' : 'statement';
}

/**
 * Build a deck from a model reply.
 *
 * Returns undefined only when there is genuinely nothing to show — a deck with
 * no slides is a failure worth reporting, not an empty presentation to open.
 */
export function parseDeck(raw: string, fallbackTitle: string): Deck | undefined {
  const parsed = deckSchema.safeParse(extractJson(raw));
  if (!parsed.success) return undefined;

  const slides: Slide[] = [];
  for (const [index, entry] of (parsed.data.slides ?? []).entries()) {
    if (slides.length >= MAX_SLIDES) break;

    const title = (entry.title ?? entry.heading ?? '').trim();
    const bullets = toBullets(entry);

    // A slide with neither a title nor content is not a slide.
    if (!title && bullets.length === 0) continue;

    slides.push({
      layout: toLayout(entry.layout, bullets.length, index),
      title: title || `Slide ${slides.length + 1}`,
      bullets,
      notes: (entry.notes ?? entry.speakerNotes)?.trim() || undefined,
    });
  }

  if (slides.length === 0) return undefined;

  return {
    title: (parsed.data.title ?? '').trim() || fallbackTitle,
    subtitle: parsed.data.subtitle?.trim() || undefined,
    slides,
  };
}

/** Escape for HTML text. Deck content is model output, never trusted markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * A self-contained HTML deck.
 *
 * No external stylesheet, script or font: the file works offline, in an email
 * attachment, and from a filesystem — and it cannot phone home from wherever
 * it ends up.
 */
export function renderDeckHtml(deck: Deck): string {
  const slides = deck.slides
    .map((slide) => {
      const bullets =
        slide.bullets.length > 0
          ? `<ul>${slide.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
          : '';
      const notes = slide.notes
        ? `<aside class="notes">${escapeHtml(slide.notes)}</aside>`
        : '';
      return `<section class="slide ${slide.layout}"><h2>${escapeHtml(slide.title)}</h2>${bullets}${notes}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(deck.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:16px/1.6 system-ui,sans-serif; background:#0b0b0c; color:#f4f4f5; }
  .deck { max-width:60rem; margin:0 auto; padding:3rem 1.5rem; }
  h1 { font-size:2.5rem; margin:0 0 .5rem; }
  .subtitle { color:#a1a1aa; margin:0 0 3rem; }
  .slide { border:1px solid #27272a; border-radius:12px; padding:2rem; margin-bottom:1.5rem; background:#141416; }
  .slide h2 { font-size:1.5rem; margin:0 0 1rem; }
  .slide.title h2 { font-size:2rem; }
  .slide ul { margin:0; padding-left:1.25rem; }
  .slide li { margin-bottom:.5rem; }
  .notes { display:block; margin-top:1.25rem; padding-top:1rem; border-top:1px solid #27272a; color:#a1a1aa; font-size:.875rem; }
  @media print { body{background:#fff;color:#000} .slide{page-break-after:always;border:0;background:#fff} }
</style></head>
<body><div class="deck">
<h1>${escapeHtml(deck.title)}</h1>
${deck.subtitle ? `<p class="subtitle">${escapeHtml(deck.subtitle)}</p>` : ''}
${slides}
</div></body></html>`;
}

/** Plain-text outline, for the artifact's searchable text. */
export function deckToText(deck: Deck): string {
  return [
    deck.title,
    deck.subtitle ?? '',
    '',
    ...deck.slides.flatMap((slide) => [
      `## ${slide.title}`,
      ...slide.bullets.map((bullet) => `- ${bullet}`),
      slide.notes ? `Notes: ${slide.notes}` : '',
      '',
    ]),
  ]
    .filter((line) => line !== '')
    .join('\n');
}
