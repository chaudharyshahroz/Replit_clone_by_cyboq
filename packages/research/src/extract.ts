/**
 * Extract readable content from HTML.
 *
 * Deliberately dependency-free and conservative. The goal is not perfect
 * article extraction — it is to discard navigation, scripts and boilerplate so
 * that what reaches a model is the page's actual prose, and to do so without
 * ever executing anything the page contains.
 *
 * Everything produced here is **untrusted data**. It is fenced and labelled
 * before it reaches a model and can never redefine instructions
 * (docs/RESEARCH_ARCHITECTURE.md).
 */

/** Elements whose contents are never page prose. */
const STRIPPED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'template',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'select',
];

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (raw, name: string) => ENTITIES[name.toLowerCase()] ?? raw);
}

function safeFromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Page title from `<title>` or the first `<h1>`. */
export function extractTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) {
    const cleaned = decodeEntities(title[1]).replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) return cleaned.slice(0, 300);
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1?.[1]) {
    const cleaned = decodeEntities(stripTags(h1[1])).replace(/\s+/g, ' ').trim();
    if (cleaned.length > 0) return cleaned.slice(0, 300);
  }
  return null;
}

/** Publication date from common metadata tags. */
export function extractPublishedAt(html: string): Date | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:date|pubdate|publish-date)["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      const parsed = new Date(match[1]);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

/**
 * Reduce a page to its readable text.
 *
 * Prefers `<article>` or `<main>` when present — those are the page telling us
 * where its content is, and trusting that beats a heuristic.
 */
export function extractReadableText(html: string, maxChars = 40_000): string {
  let working = html;

  // Comments can contain markup that confuses later stripping.
  working = working.replace(/<!--[\s\S]*?-->/g, ' ');

  for (const element of STRIPPED_ELEMENTS) {
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?<\\/${element}>`, 'gi'),
      ' ',
    );
    // Self-closing or unclosed variants.
    working = working.replace(new RegExp(`<${element}\\b[^>]*\\/?>`, 'gi'), ' ');
  }

  const main =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(working)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(working)?.[1] ??
    working;

  // Preserve block structure as newlines so paragraphs survive.
  const withBreaks = main
    .replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');

  const text = decodeEntities(stripTags(withBreaks));

  const normalized = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    // Drop fragments too short to be prose — leftover nav labels and the like.
    .filter((line) => line.length > 2)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n\n[… truncated]` : normalized;
}

/**
 * True when extracted content looks like a real article rather than a
 * cookie wall, error page, or JavaScript shell. Prevents a page of boilerplate
 * being cited as evidence.
 */
export function looksSubstantive(text: string): boolean {
  if (text.length < 200) return false;
  const words = text.split(/\s+/).length;
  if (words < 40) return false;

  const lower = text.toLowerCase();
  const blockers = [
    'enable javascript',
    'please enable cookies',
    'access denied',
    'are you a robot',
    'verify you are human',
    '404 not found',
  ];
  // Only treat these as disqualifying on a short page — a long article
  // mentioning "access denied" in passing is still an article.
  return !(text.length < 1_200 && blockers.some((phrase) => lower.includes(phrase)));
}
