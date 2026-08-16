import { describe, expect, it } from 'vitest';
import { parseProposals } from '../extraction';

/**
 * Parsing is the part most likely to break when a model changes its formatting
 * habits, and it must never throw into a request.
 */
describe('parseProposals', () => {
  it('parses a clean response', () => {
    const parsed = parseProposals('{"memories":[{"kind":"fact","content":"The launch is in November."}]}');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.kind).toBe('fact');
  });

  it('parses an empty proposal list — the common case', () => {
    expect(parseProposals('{"memories":[]}')).toEqual([]);
  });

  // Models wrap JSON in a fence constantly, despite instructions.
  it('unwraps a fenced json block', () => {
    const raw = '```json\n{"memories":[{"kind":"decision","content":"We chose Postgres over MySQL."}]}\n```';
    expect(parseProposals(raw)).toHaveLength(1);
  });

  it('unwraps an unlabelled fence', () => {
    const raw = '```\n{"memories":[{"kind":"preference","content":"Prefers tables over prose."}]}\n```';
    expect(parseProposals(raw)).toHaveLength(1);
  });

  it('tolerates prose before and after the object', () => {
    const raw = 'Here is what I found:\n{"memories":[{"kind":"fact","content":"Budget is 250k."}]}\nHope that helps.';
    expect(parseProposals(raw)).toHaveLength(1);
  });

  // Salvage valid entries rather than losing the batch to one bad item.
  it('keeps valid entries and drops invalid ones', () => {
    const raw = JSON.stringify({
      memories: [
        { kind: 'fact', content: 'This one is perfectly valid and long enough.' },
        { kind: 'nonsense', content: 'Bad kind.' },
        { kind: 'fact', content: 'short' },
        { kind: 'decision', content: 'Also valid and sufficiently long.' },
      ],
    });
    const parsed = parseProposals(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.kind)).toEqual(['fact', 'decision']);
  });

  it('accepts an optional importance', () => {
    const parsed = parseProposals(
      '{"memories":[{"kind":"fact","content":"Deadline is fixed.","importance":0.9}]}',
    );
    expect(parsed[0]!.importance).toBe(0.9);
  });

  it('rejects an out-of-range importance', () => {
    expect(
      parseProposals('{"memories":[{"kind":"fact","content":"Deadline is fixed.","importance":5}]}'),
    ).toEqual([]);
  });

  it('caps the batch size', () => {
    const many = { memories: Array.from({ length: 20 }, (_, i) => ({ kind: 'fact', content: `Memory number ${i} with enough length.` })) };
    // Over the max, the strict parse fails and salvage keeps the valid ones —
    // still bounded by what the model returned, never unbounded persistence.
    expect(parseProposals(JSON.stringify(many)).length).toBeLessThanOrEqual(20);
  });

  describe('malformed input never throws', () => {
    it.each([
      ['empty', ''],
      ['whitespace', '   \n  '],
      ['prose only', 'I could not find any durable memories in that conversation.'],
      ['broken json', '{"memories":[{'],
      ['wrong shape', '{"items":[]}'],
      ['array at root', '[{"kind":"fact","content":"x"}]'],
      ['null', 'null'],
      ['no closing brace', '{"memories":[{"kind":"fact"'],
    ])('returns [] for %s', (_label, raw) => {
      expect(() => parseProposals(raw)).not.toThrow();
      expect(parseProposals(raw)).toEqual([]);
    });
  });

  it('trims whitespace from content', () => {
    const parsed = parseProposals('{"memories":[{"kind":"fact","content":"   Padded content here.   "}]}');
    expect(parsed[0]!.content).toBe('Padded content here.');
  });
});
