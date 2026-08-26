/**
 * Catching a model that has started repeating itself.
 *
 * A quantised model answered "hi" with the same sentence more than a hundred
 * times, then began reciting the system prompt, and ran until it hit the output
 * limit. Every token was streamed to the reader and charged for.
 *
 * The risk in fixing that is cutting short a long, correct answer — so these
 * tests care as much about what the guard must not stop as about what it must.
 */
import { describe, expect, it } from 'vitest';
import { LoopGuard } from '../loop-guard';

/** Feed text a chunk at a time, as a provider would, and report when it trips. */
function run(chunks: readonly string[]): boolean {
  const guard = new LoopGuard();
  return chunks.some((chunk) => guard.push(chunk));
}

const LOOP = "I'm ready to help you research, create, build, or take action. ";

describe('a looping model', () => {
  it('is caught when one sentence repeats', () => {
    expect(run(Array.from({ length: 10 }, () => LOOP))).toBe(true);
  });

  it('is caught even when the repeats are split across chunks', () => {
    /*
     * A chunk boundary falls wherever the provider flushed, which has nothing
     * to do with where a sentence ends. Splitting mid-sentence is the normal
     * case, not the exception.
     */
    const stream = LOOP.repeat(10);
    const chunks = stream.match(/.{1,7}/g) ?? [];
    expect(run(chunks)).toBe(true);
  });

  it('does not fire before it is certain', () => {
    // Twice is a coincidence; a handful is a pattern.
    expect(run([LOOP, LOOP, LOOP])).toBe(false);
  });
});

describe('an ordinary answer', () => {
  it('is left alone however long it runs', () => {
    const prose = Array.from(
      { length: 200 },
      (_unused, index) => `This is sentence number ${index} and it says something different. `,
    );
    expect(run(prose)).toBe(false);
  });

  it('survives a repeated short phrase', () => {
    /*
     * "Yes." and "Done." recur legitimately, and a list can repeat a stem. Only
     * a substantial sentence repeating counts.
     */
    expect(run(Array.from({ length: 30 }, () => 'Yes. '))).toBe(false);
    expect(run(Array.from({ length: 30 }, () => 'OK\n'))).toBe(false);
  });

  it('survives a table or list with a repeating column', () => {
    const rows = Array.from({ length: 40 }, (_unused, index) => `| row ${index} | free | yes |\n`);
    expect(run(rows)).toBe(false);
  });

  it('survives code that repeats a line', () => {
    // Real code does this — imports, closing braces, repeated calls.
    const code = Array.from({ length: 20 }, () => '  return null;\n');
    expect(run(code)).toBe(false);
  });
});

describe('the JSX a build streams', () => {
  it('is not mistaken for a loop', () => {
    /*
     * Build streams whole components. Identical consecutive lines occur — a
     * repeated wrapper, a run of closing tags — and cutting a generation short
     * would lose the whole application, not just a paragraph.
     */
    const jsx = [
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
      '      <div className="flex items-center gap-2">\n',
    ];
    expect(run(jsx)).toBe(false);
  });
});
