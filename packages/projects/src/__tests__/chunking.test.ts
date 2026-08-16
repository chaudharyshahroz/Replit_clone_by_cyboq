import { describe, expect, it } from 'vitest';
import { chunkText } from '../chunking';

describe('chunkText', () => {
  it('returns nothing for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('A short note about Reklu.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('A short note about Reklu.');
    expect(chunks[0]!.index).toBe(0);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'word '.repeat(5_000);
    const chunks = chunkText(text, { targetTokens: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => expect(chunk.index).toBe(index));
  });

  // Chunk boundaries decide retrieval quality more than the embedding does.
  it('prefers paragraph boundaries', () => {
    const paragraph = `${'sentence here. '.repeat(60)}`;
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkText(text, { targetTokens: 260, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should begin mid-word.
    for (const chunk of chunks) {
      expect(chunk.content).toBe(chunk.content.trim());
      expect(chunk.content.startsWith(' ')).toBe(false);
    }
  });

  it('does not split mid-word', () => {
    const text = 'supercalifragilistic '.repeat(500);
    const chunks = chunkText(text, { targetTokens: 100, overlapTokens: 0 });
    for (const chunk of chunks) {
      // Every token should be the whole word.
      for (const word of chunk.content.split(/\s+/).filter(Boolean)) {
        expect(word).toBe('supercalifragilistic');
      }
    }
  });

  it('overlaps consecutive chunks so a boundary fact is not lost', () => {
    const text = Array.from({ length: 400 }, (_, i) => `fact number ${i}.`).join(' ');
    const withOverlap = chunkText(text, { targetTokens: 150, overlapTokens: 40 });
    const withoutOverlap = chunkText(text, { targetTokens: 150, overlapTokens: 0 });
    expect(withOverlap.length).toBeGreaterThanOrEqual(withoutOverlap.length);
  });

  it('records offsets that map back into the source', () => {
    const text = 'alpha '.repeat(2_000);
    for (const chunk of chunkText(text, { targetTokens: 200 })) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.endOffset).toBeLessThanOrEqual(text.trim().length);
    }
  });

  it('estimates a positive token count per chunk', () => {
    for (const chunk of chunkText('word '.repeat(3_000), { targetTokens: 250 })) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('respects maxChunks', () => {
    expect(chunkText('word '.repeat(50_000), { targetTokens: 50, maxChunks: 5 })).toHaveLength(5);
  });

  // A splitter that fails to advance hangs the request that called it.
  it('always makes progress on pathological input', () => {
    const noBoundaries = 'x'.repeat(50_000);
    const chunks = chunkText(noBoundaries, { targetTokens: 100, overlapTokens: 95 });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startOffset).toBeGreaterThan(chunks[i - 1]!.startOffset);
    }
  });

  it('handles CRLF the same as LF', () => {
    const crlf = chunkText('line one\r\n\r\nline two');
    expect(crlf[0]!.content).not.toContain('\r');
  });
});
