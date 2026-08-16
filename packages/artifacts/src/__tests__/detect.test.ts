import { describe, expect, it } from 'vitest';
import { deriveTitle, detectArtifact, extractCodeBlocks } from '../detect';

const para = (n: number) =>
  Array.from({ length: n }, (_, i) => `This is paragraph ${i} with enough words to be real prose about the subject at hand.`).join('\n\n');

describe('detectArtifact — negatives (the common case)', () => {
  // False positives are worse than false negatives: clutter trains users to
  // ignore the panel.
  it('ignores a short answer', () => {
    expect(detectArtifact('Yes, that works.')).toBeUndefined();
  });

  it('ignores empty input', () => {
    expect(detectArtifact('')).toBeUndefined();
    expect(detectArtifact('   \n  ')).toBeUndefined();
  });

  it('ignores a long but unstructured ramble', () => {
    const rambling = para(20);
    expect(rambling.length).toBeGreaterThan(1_200);
    expect(detectArtifact(rambling)).toBeUndefined();
  });

  it('ignores a short code snippet', () => {
    expect(detectArtifact('Use this:\n\n```ts\nconst x = 1;\n```')).toBeUndefined();
  });

  it('ignores a two-row table', () => {
    expect(detectArtifact('| a | b |\n|---|---|\n| 1 | 2 |')).toBeUndefined();
  });

  it('ignores an empty code fence', () => {
    expect(detectArtifact('```ts\n```')).toBeUndefined();
  });
});

describe('detectArtifact — documents', () => {
  it('detects long structured prose', () => {
    const markdown = `# Launch Plan\n\n${para(8)}\n\n## Timeline\n\n${para(8)}`;
    const candidate = detectArtifact(markdown);
    expect(candidate?.type).toBe('document');
    expect(candidate?.title).toBe('Launch Plan');
  });

  it('requires structure, not just length', () => {
    const longNoHeadings = para(30);
    expect(detectArtifact(longNoHeadings)).toBeUndefined();
  });

  it('accepts length plus a large table instead of headings', () => {
    const table = ['| item | value |', '|---|---|', ...Array.from({ length: 8 }, (_, i) => `| row ${i} | ${i} |`)].join('\n');
    const content = `${para(16)}\n\n${table}`;
    // Guard the fixture itself: an undersized one would pass for the wrong reason.
    expect(content.length).toBeGreaterThan(1_200);
    expect(detectArtifact(content)?.type).toBe('document');
  });

  it('leaves content just under the threshold alone', () => {
    const table = ['| item | value |', '|---|---|', ...Array.from({ length: 8 }, (_, i) => `| row ${i} | ${i} |`)].join('\n');
    const content = `${para(10)}\n\n${table}`;
    expect(content.length).toBeLessThan(1_200);
    expect(detectArtifact(content)).toBeUndefined();
  });
});

describe('detectArtifact — code', () => {
  const bigBlock = (lines: number, lang = 'ts') =>
    '```' + lang + '\n' + Array.from({ length: lines }, (_, i) => `const line${i} = ${i};`).join('\n') + '\n```';

  it('detects a substantial code block', () => {
    const candidate = detectArtifact(`Here you go:\n\n${bigBlock(40)}`);
    expect(candidate?.type).toBe('code');
    expect(candidate?.language).toBe('ts');
  });

  it('stores only the code, not the surrounding prose', () => {
    const candidate = detectArtifact(`Some explanation.\n\n${bigBlock(40)}`);
    expect(candidate?.content).not.toContain('Some explanation');
    expect(candidate?.content).toContain('const line0');
    expect(candidate?.content).not.toContain('```');
  });

  it('picks the largest block when several are present', () => {
    const candidate = detectArtifact(`${bigBlock(5, 'sh')}\n\n${bigBlock(40, 'python')}`);
    expect(candidate?.language).toBe('python');
  });

  // A long article that happens to include a code sample is a document.
  it('prefers document when prose outweighs the code', () => {
    const candidate = detectArtifact(`# Guide\n\n${para(20)}\n\n## Example\n\n${bigBlock(25)}\n\n${para(20)}`);
    expect(candidate?.type).toBe('document');
  });

  it('defaults an unlabelled fence to text', () => {
    const unlabelled = '```\n' + Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n```';
    expect(detectArtifact(unlabelled)?.language).toBe('text');
  });
});

describe('detectArtifact — tables', () => {
  it('detects a standalone table as a spreadsheet', () => {
    const table = ['| name | qty |', '|---|---|', ...Array.from({ length: 6 }, (_, i) => `| item ${i} | ${i} |`)].join('\n');
    const candidate = detectArtifact(table);
    expect(candidate?.type).toBe('spreadsheet');
  });
});

describe('extractCodeBlocks', () => {
  it('handles an unterminated fence, which streaming produces mid-flight', () => {
    const blocks = extractCodeBlocks('```ts\nconst a = 1;\nconst b = 2;');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toContain('const b = 2;');
  });

  it('returns nothing when there are no fences', () => {
    expect(extractCodeBlocks('plain text')).toEqual([]);
  });

  it('reports line counts', () => {
    expect(extractCodeBlocks('```js\na\nb\nc\n```')[0]!.lines).toBe(3);
  });
});

describe('deriveTitle', () => {
  it('prefers the first heading', () => {
    expect(deriveTitle('# Quarterly Report\n\nBody text.', 'x')).toBe('Quarterly Report');
  });

  it('strips markdown emphasis', () => {
    expect(deriveTitle('## **Bold** _Title_', 'x')).toBe('Bold Title');
  });

  // Titles are labels, not sentences — trailing punctuation is stripped.
  it('falls back to the first sentence, without its full stop', () => {
    expect(deriveTitle('The launch plan is ready. More detail follows.', 'x')).toBe(
      'The launch plan is ready',
    );
  });

  it('skips fences and table rows when looking for a title', () => {
    expect(deriveTitle('```ts\ncode\n```\nActual descriptive sentence here.', 'x')).toBe(
      'Actual descriptive sentence here',
    );
  });

  it('uses the fallback when nothing usable exists', () => {
    expect(deriveTitle('| a |\n| b |', 'Untitled')).toBe('Untitled');
  });

  it('truncates a very long title', () => {
    expect(deriveTitle(`# ${'word '.repeat(100)}`, 'x').length).toBeLessThanOrEqual(80);
  });
});
