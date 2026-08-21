/**
 * Pacing finished text so it can be read as it arrives.
 *
 * Two properties matter and both have failed in this codebase already. The
 * chunks must reassemble into exactly the original — losing a newline breaks
 * every markdown heading and table in the report. And the reveal must take
 * about the same time whatever the length, because a fixed per-word delay made
 * a long report take longer to display than it took to produce.
 */
import { describe, expect, it } from 'vitest';
import { planPacing } from '../paced-text';

const rebuild = (text: string): string => planPacing(text).chunks.join('');

describe('planPacing', () => {
  it('reassembles into exactly the original text', () => {
    const report = '## Heading\n\nA line of prose.\n\n- one\n- two\n';
    expect(rebuild(report)).toBe(report);
  });

  it('keeps the blank lines markdown depends on', () => {
    const report = 'Para one.\n\nPara two.';
    expect(rebuild(report)).toContain('\n\n');
  });

  it('preserves a table exactly', () => {
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(rebuild(table)).toBe(table);
  });

  /** A long report must not take proportionally longer to reveal. */
  it('holds the reveal to roughly the same duration at any length', () => {
    const short = planPacing('one two three four five');
    const long = planPacing('word '.repeat(4_000));

    const duration = (plan: ReturnType<typeof planPacing>): number =>
      plan.chunks.length * plan.delayMs;

    // The long text is 800 times the words; its reveal must not be 800 times
    // the wait.
    expect(duration(long)).toBeLessThan(duration(short) * 4 + 4_000);
  });

  it('gives a long report more chunks than a short one', () => {
    expect(planPacing('word '.repeat(2_000)).chunks.length).toBeGreaterThan(
      planPacing('one two').chunks.length,
    );
  });

  it('handles an empty string without producing a chunk', () => {
    expect(planPacing('').chunks).toEqual([]);
  });

  it('handles a single word', () => {
    expect(rebuild('hello')).toBe('hello');
  });

  it('never emits an empty chunk', () => {
    const plan = planPacing('## Heading\n\nSome prose here.\n');
    expect(plan.chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });
});
