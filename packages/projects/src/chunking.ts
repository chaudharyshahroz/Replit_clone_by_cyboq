/**
 * Text chunking for retrieval.
 *
 * Chunk boundaries decide retrieval quality more than the embedding model does:
 * a passage cut mid-sentence retrieves poorly and reads badly when shown as
 * evidence. So the splitter prefers structural boundaries — paragraphs, then
 * sentences — and only splits mid-sentence for text that offers neither.
 *
 * Overlap exists so a fact spanning a boundary is not lost to both chunks.
 */

export interface Chunk {
  readonly index: number;
  readonly content: string;
  readonly tokenCount: number;
  /** Character offsets in the source, for citation back to the original. */
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ChunkOptions {
  /** Target size. ~1000 tokens is a good default for retrieval granularity. */
  readonly targetTokens?: number;
  readonly overlapTokens?: number;
  readonly maxChunks?: number;
}

const CHARS_PER_TOKEN = 4;
const estimate = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export function chunkText(text: string, options: ChunkOptions = {}): readonly Chunk[] {
  const targetTokens = options.targetTokens ?? 1_000;
  const overlapTokens = options.overlapTokens ?? 100;
  const maxChunks = options.maxChunks ?? 2_000;

  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];

  // Short enough to be one chunk — splitting would only hurt retrieval.
  if (normalized.length <= targetChars) {
    return [
      {
        index: 0,
        content: normalized,
        tokenCount: estimate(normalized),
        startOffset: 0,
        endOffset: normalized.length,
      },
    ];
  }

  const chunks: Chunk[] = [];
  let cursor = 0;

  while (cursor < normalized.length && chunks.length < maxChunks) {
    const hardEnd = Math.min(cursor + targetChars, normalized.length);
    let end = hardEnd;

    if (hardEnd < normalized.length) {
      // Prefer a paragraph break in the last third of the window.
      const searchFrom = cursor + Math.floor(targetChars * 0.6);
      const paragraph = normalized.lastIndexOf('\n\n', hardEnd);
      if (paragraph > searchFrom) {
        end = paragraph;
      } else {
        // Then a sentence end.
        const sentence = findLastSentenceEnd(normalized, searchFrom, hardEnd);
        if (sentence > searchFrom) {
          end = sentence;
        } else {
          // Then any whitespace, so we do not split a word.
          const space = normalized.lastIndexOf(' ', hardEnd);
          if (space > searchFrom) end = space;
        }
      }
    }

    const content = normalized.slice(cursor, end).trim();
    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        tokenCount: estimate(content),
        startOffset: cursor,
        endOffset: end,
      });
    }

    if (end >= normalized.length) break;

    // Step forward with overlap, but always make progress — without this guard
    // a pathological input loops forever.
    const next = Math.max(cursor + 1, end - overlapChars);
    cursor = next;
  }

  return chunks;
}

/** Last `. ` / `! ` / `? ` / newline in the window, or -1. */
function findLastSentenceEnd(text: string, from: number, to: number): number {
  for (let i = to - 1; i > from; i--) {
    const char = text[i];
    if (char === '\n') return i;
    if ((char === '.' || char === '!' || char === '?') && /\s/.test(text[i + 1] ?? ' ')) {
      return i + 1;
    }
  }
  return -1;
}
