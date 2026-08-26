/**
 * Stop a model that has started repeating itself.
 *
 * A quantised model can fall into emitting the same sentence over and over. One
 * did: it answered "hi" with the same line more than a hundred times, then
 * began reciting the system prompt, and ran until it hit the output limit.
 * Every token of that was streamed to the reader and charged for, because
 * nothing was watching.
 *
 * The detector is deliberately dull. It looks for one sentence repeating, which
 * is what the failure looks like, and it needs several repeats before acting —
 * a model can legitimately say "OK." twice, and a list can legitimately repeat
 * a stem. What it must never do is cut short a long, correct answer, so the
 * threshold is set where no ordinary prose reaches.
 */

/** How many identical sentences in a row before the answer is a loop. */
const REPEATS = 6;

/**
 * What counts as a sentence worth watching.
 *
 * A loop is prose repeating. Code repeats lines legitimately and constantly —
 * twenty `return null;` in one file is ordinary, and an early version of this
 * cut a generation short because of it. Requiring several words and real length
 * excludes a line of code while still catching the failure, whose repeated
 * sentence ran to eleven words.
 */
const MIN_LENGTH = 25;
const MIN_WORDS = 6;

export class LoopGuard {
  private buffer = '';
  private last = '';
  private streak = 0;

  /**
   * Feed the next chunk. Returns true when the model is looping.
   *
   * Sentences are split off as they complete, because a chunk boundary falls
   * wherever the provider happened to flush and has nothing to do with where a
   * sentence ends.
   */
  push(text: string): boolean {
    this.buffer += text;

    /* Split on terminators, keeping whatever follows the last one. */
    const parts = this.buffer.split(/(?<=[.!?\n])/);
    this.buffer = parts.pop() ?? '';

    for (const part of parts) {
      const sentence = part.trim();
      if (sentence.length < MIN_LENGTH) continue;
      if (sentence.split(/\s+/).length < MIN_WORDS) continue;

      if (sentence === this.last) {
        this.streak += 1;
        if (this.streak >= REPEATS) return true;
      } else {
        this.last = sentence;
        this.streak = 1;
      }
    }

    return false;
  }
}

/** What to tell somebody whose answer was cut off, and why. */
export const LOOP_MESSAGE =
  '\n\n[Reklu stopped this reply: the model began repeating itself. ' +
  'This usually means the model is a poor fit for the request — try another one.]';
