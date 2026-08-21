/**
 * Delivering finished text as if it were being written.
 *
 * Research produces its whole report before anything can be sent, so there is
 * nothing to stream in the way a chat reply streams. Handing a reader ten
 * paragraphs in one frame gives them nowhere to start; releasing it in pieces
 * lets them read from the top while the rest arrives.
 *
 * This is pacing, not progress. The work is already done, and nothing here
 * claims otherwise — the honest progress is the stage reporting that ran while
 * the research was actually happening.
 *
 * The rate is derived from the length rather than fixed, so a short answer is
 * not padded out and a long one does not take a minute to appear. A fixed
 * delay per word would have made a 3,000-word report take longer to display
 * than it took to produce.
 */
export interface PacingPlan {
  /** Text pieces, in order, that reassemble into the original exactly. */
  readonly chunks: readonly string[];
  /** Milliseconds to wait between chunks. */
  readonly delayMs: number;
}

/** How long the whole reveal should take, however much text there is. */
const TARGET_MS = 3_500;
/** A tick short enough to read as motion rather than as steps. */
const TICK_MS = 24;

export function planPacing(text: string, targetMs: number = TARGET_MS): PacingPlan {
  // Words with their trailing whitespace, so joining restores the original
  // exactly — including the newlines that markdown depends on.
  const words = text.match(/\S+\s*/g) ?? [];
  if (words.length === 0) return { chunks: text ? [text] : [], delayMs: TICK_MS };

  const ticks = Math.max(1, Math.round(targetMs / TICK_MS));
  const wordsPerChunk = Math.max(1, Math.ceil(words.length / ticks));

  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += wordsPerChunk) {
    chunks.push(words.slice(index, index + wordsPerChunk).join(''));
  }

  return { chunks, delayMs: TICK_MS };
}
