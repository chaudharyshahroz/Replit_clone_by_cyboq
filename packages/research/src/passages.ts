/**
 * Locating the passage in a source that supports a claim (spec §24).
 *
 * Storing the source's opening paragraph was a placeholder, and a poor one: a
 * hover preview showing text unrelated to the claim is worse than no preview,
 * because it looks like evidence while proving nothing.
 *
 * This finds the span of the source that actually overlaps the claim, using
 * term overlap over a sliding window. It is deliberately lexical: an embedding
 * call per citation would be slow and costly, and the goal here is to *locate*
 * text the model already decided was relevant, not to judge relevance afresh.
 */

/** Words carrying no signal for locating a passage. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may',
  'about', 'into', 'over', 'their', 'there', 'which', 'while', 'also', 'more',
]);

/** Content words, lowercased and de-duplicated. */
export function significantTerms(text: string): readonly string[] {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

export interface LocatedPassage {
  readonly passage: string;
  /** Character offset in the source content. */
  readonly offset: number;
  /** Fraction of claim terms present, 0–1. */
  readonly overlap: number;
}

export interface LocateOptions {
  /** Target passage length. Long enough to read, short enough to check. */
  readonly windowChars?: number;
  /** Below this overlap, no passage is returned rather than a misleading one. */
  readonly minOverlap?: number;
}

/**
 * Find the best-matching span of `content` for `claim`.
 *
 * Returns undefined when nothing overlaps meaningfully — the caller stores no
 * passage rather than an arbitrary one. An honest gap beats a false exhibit.
 */
export function locatePassage(
  claim: string,
  content: string,
  options: LocateOptions = {},
): LocatedPassage | undefined {
  const windowChars = options.windowChars ?? 600;
  const minOverlap = options.minOverlap ?? 0.2;

  const text = content.trim();
  if (text.length === 0) return undefined;

  const terms = significantTerms(claim);
  if (terms.length === 0) return undefined;

  // Split on sentence and paragraph boundaries so a passage starts somewhere
  // readable rather than mid-word.
  const boundaries = sentenceBoundaries(text);
  if (boundaries.length === 0) return undefined;

  let best: LocatedPassage | undefined;

  for (const start of boundaries) {
    const slice = text.slice(start, start + windowChars).toLowerCase();
    if (slice.length === 0) continue;

    let hits = 0;
    for (const term of terms) {
      if (slice.includes(term)) hits++;
    }
    const overlap = hits / terms.length;

    if (!best || overlap > best.overlap) {
      best = {
        passage: trimToBoundary(text.slice(start, start + windowChars)),
        offset: start,
        overlap,
      };
    }
    // A window containing every term cannot be beaten.
    if (overlap === 1) break;
  }

  if (!best || best.overlap < minOverlap) return undefined;
  return best;
}

/** Offsets where a sentence or paragraph begins. */
function sentenceBoundaries(text: string): readonly number[] {
  const offsets: number[] = [0];
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i];
    if (char === '\n') {
      offsets.push(i + 1);
      continue;
    }
    if ((char === '.' || char === '!' || char === '?') && /\s/.test(text[i + 1] ?? '')) {
      offsets.push(i + 2);
    }
  }
  // Cap the number of windows examined so a huge source cannot make this
  // quadratic in practice.
  const stride = Math.max(1, Math.ceil(offsets.length / 400));
  return offsets.filter((_, index) => index % stride === 0);
}

/** End a passage at a sentence boundary where possible, so it reads whole. */
function trimToBoundary(passage: string): string {
  const trimmed = passage.trim();
  if (trimmed.length < 120) return trimmed;

  for (let i = trimmed.length - 1; i > trimmed.length * 0.6; i--) {
    const char = trimmed[i];
    if (char === '.' || char === '!' || char === '?') {
      return trimmed.slice(0, i + 1);
    }
  }
  return trimmed;
}
