/**
 * Syntax colouring.
 *
 * The failure that matters is not a missed keyword — it is losing a character.
 * A viewer that silently drops part of a file is worse than one that colours
 * nothing, so every case here reassembles the tokens and compares them to the
 * input.
 *
 * The second failure that matters is precedence: a `//` inside a string, or a
 * keyword inside a comment. Getting that wrong is what makes a naive
 * highlighter look broken on ordinary code.
 */
import { describe, expect, it } from 'vitest';
import { tokenize, type Token } from '@/lib/highlight';

const rebuild = (tokens: readonly Token[]): string => tokens.map((t) => t.text).join('');
const kindOf = (tokens: readonly Token[], text: string) =>
  tokens.find((t) => t.text === text)?.kind;

describe('never losing the source', () => {
  const samples: readonly [string, string][] = [
    ['tsx', 'export function App() {\n  return <div className="x">hi</div>;\n}\n'],
    ['css', ':root {\n  --accent: #ff5a1f;\n}\n.button { padding: 8px 12px; }\n'],
    ['json', '{"name":"demo","version":"1.0.0","private":true}'],
    ['html', '<!doctype html>\n<html lang="en"><body>hi</body></html>'],
    ['md', '# Heading\n\nSome *text* with `code`.\n'],
    ['ts', ''],
  ];

  for (const [language, source] of samples) {
    it(`reassembles ${language || 'plain'} exactly`, () => {
      expect(rebuild(tokenize(source, language))).toBe(source);
    });
  }

  it('reassembles a file with unusual characters', () => {
    const source = 'const s = "héllo — 世界"; // note\n';
    expect(rebuild(tokenize(source, 'ts'))).toBe(source);
  });
});

describe('precedence', () => {
  /* The classic break: a comment marker inside a string. */
  it('keeps a URL inside a string as a string', () => {
    const tokens = tokenize('const u = "https://example.com/x";', 'ts');
    expect(kindOf(tokens, '"https://example.com/x"')).toBe('string');
    expect(tokens.some((t) => t.kind === 'comment')).toBe(false);
  });

  /* And its mirror: a keyword inside a comment. */
  it('keeps a keyword inside a comment as a comment', () => {
    const tokens = tokenize('// return const function\n', 'ts');
    expect(tokens[0]?.kind).toBe('comment');
    expect(tokens.some((t) => t.kind === 'keyword')).toBe(false);
  });

  it('handles a block comment spanning lines', () => {
    const source = '/*\n * const x = 1;\n */\nconst y = 2;';
    const tokens = tokenize(source, 'ts');

    expect(tokens[0]?.kind).toBe('comment');
    expect(kindOf(tokens, 'const')).toBe('keyword');
    expect(rebuild(tokens)).toBe(source);
  });

  it('handles an apostrophe inside a double-quoted string', () => {
    const source = `const s = "it's fine";`;
    const tokens = tokenize(source, 'ts');
    expect(kindOf(tokens, `"it's fine"`)).toBe('string');
    expect(rebuild(tokens)).toBe(source);
  });

  it('handles an escaped quote', () => {
    const source = 'const s = "a \\" b";';
    expect(rebuild(tokenize(source, 'ts'))).toBe(source);
  });
});

describe('what gets coloured', () => {
  it('marks keywords, strings and numbers in TypeScript', () => {
    const tokens = tokenize('const n = 42; import x from "y";', 'ts');

    expect(kindOf(tokens, 'const')).toBe('keyword');
    expect(kindOf(tokens, '42')).toBe('number');
    expect(kindOf(tokens, '"y"')).toBe('string');
  });

  it('marks custom properties and units in CSS', () => {
    const tokens = tokenize('.a { --x: 4px; }', 'css');
    expect(kindOf(tokens, '--x')).toBe('keyword');
    expect(kindOf(tokens, '4px')).toBe('number');
  });

  it('marks literals in JSON without treating keys as keywords', () => {
    const tokens = tokenize('{"enabled": true, "count": 3}', 'json');
    expect(kindOf(tokens, 'true')).toBe('keyword');
    expect(kindOf(tokens, '3')).toBe('number');
    expect(kindOf(tokens, '"enabled"')).toBe('string');
  });

  it('leaves an unknown language entirely plain rather than guessing', () => {
    const tokens = tokenize('SELECT * FROM t;', 'sql');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe('plain');
  });
});
