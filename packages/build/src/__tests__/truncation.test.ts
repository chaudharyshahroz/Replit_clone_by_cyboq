/**
 * Catching a file that stopped arriving.
 *
 * Both fixtures here are the real thing, taken from a build whose preview never
 * compiled. Truncation was inferred from an odd number of code fences and from
 * `finishReason === 'length'`; neither held, so half a file reached the sandbox
 * and the reader was shown a compiler error three layers from the cause.
 *
 * The false-positive cases matter as much. A file wrongly called truncated
 * costs a model call to "complete" something that was already finished, so a
 * regular expression containing a bracket, or a brace inside a string, must not
 * be mistaken for structure.
 */
import { describe, expect, it } from 'vitest';
import { truncatedFiles, truncationOf } from '../truncation';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('.tsx') ? 'tsx' : 'ts',
});

describe('files that stopped early', () => {
  it('catches the data file that ended mid-object', () => {
    /* Next said `Unexpected eof`, which at least points at the end. */
    const truncated = file(
      'src/lib/property-data.ts',
      [
        "export const mockTestimonials: Testimonial[] = [",
        '  {',
        "    id: '1',",
        "    author: 'Jennifer & David Park',",
        '   ',
      ].join('\n'),
    );

    expect(truncationOf(truncated)).toMatchObject({
      path: 'src/lib/property-data.ts',
      reason: 'unclosed-bracket',
    });
  });

  it('catches the page that ended inside its JSX tree', () => {
    /*
     * Next said "Unexpected token `div`. Expected jsx identifier", naming a
     * perfectly ordinary tag — which is what SWC says when an element is never
     * closed, and reads as though the tag itself were wrong.
     */
    const truncated = file(
      'src/app/page.tsx',
      [
        'export default function HomePage() {',
        '  return (',
        '    <div data-reklu-id="BXT_JRGjY9" className="min-h-screen">',
        '      <Header />',
        '      <main data-reklu-id="kvmrMTOXUQ">',
      ].join('\n'),
    );

    expect(truncationOf(truncated)?.reason).toBe('unclosed-bracket');
  });

  it('says what was left open, and where', () => {
    const detail = truncationOf(file('a.ts', 'const a = {\n  b: 1,\n'))?.detail;
    expect(detail).toContain("'{'");
    expect(detail).toContain('line 1');
  });

  it('catches a string and a template that never close', () => {
    expect(truncationOf(file('a.ts', "const a = 'unterminated"))?.reason).toBe(
      'unterminated-string',
    );
    expect(truncationOf(file('a.ts', 'const a = `unterminated ${x}'))?.reason).toBe(
      'unterminated-template',
    );
  });

  it('catches a block comment that swallowed the rest of the file', () => {
    expect(truncationOf(file('a.ts', 'const a = 1;\n/* explaining'))?.reason).toBe(
      'unterminated-comment',
    );
  });

  it('reports every truncated file in a tree', () => {
    const files = [
      file('a.ts', 'export const a = 1;\n'),
      file('b.ts', 'export const b = {\n'),
      file('c.tsx', 'export const c = () => <div>hi</div>;\n'),
      file('d.ts', 'export const d = [\n'),
    ];
    expect(truncatedFiles(files).map((t) => t.path)).toEqual(['b.ts', 'd.ts']);
  });
});

describe('files that are complete', () => {
  it('accepts ordinary source', () => {
    expect(
      truncationOf(
        file(
          'src/app/page.tsx',
          [
            'export default function HomePage() {',
            '  return (',
            '    <div className="min-h-screen">',
            '      <Header />',
            '    </div>',
            '  );',
            '}',
          ].join('\n'),
        ),
      ),
    ).toBeUndefined();
  });

  it('is not fooled by brackets inside strings or comments', () => {
    const tricky = [
      "const open = '{';",
      'const arr = "[unclosed";',
      '// a trailing ) in a comment',
      '/* and a { in a block */',
      'const t = `a ${ { nested: 1 } } b`;',
      'export const done = true;',
    ].join('\n');
    expect(truncationOf(file('a.ts', tricky))).toBeUndefined();
  });

  it('is not fooled by a regular expression containing a bracket', () => {
    /*
     * The reason this file bothers to know what a regex is: `/[{(/` is three
     * unbalanced openers to anything that cannot tell a pattern from division.
     */
    const withRegex = [
      'const re = /[{(]/g;',
      'const cls = /^[a-z]{2,}$/;',
      'const ratio = total / count;',
      'const div = (a: number) => a / 2;',
      'export const ok = true;',
    ].join('\n');
    expect(truncationOf(file('a.ts', withRegex))).toBeUndefined();
  });

  it('reads a pattern that follows a line comment, not the comment’s last word', () => {
    /*
     * Found by running this over 534 files in this repository that are known to
     * be complete. `logger.ts` ends a line `/g, // JWT`, and reading backwards
     * from the next line's pattern found the word JWT — a value, so the `/` was
     * taken for division and the quotes inside its character class became an
     * unterminated string. Reading backwards cannot see that text is a comment.
     */
    const source = [
      'const patterns = [',
      '  /\\beyJ[A-Za-z0-9_-]{10,}\\b/g, // JWT',
      '  /\\bpostgres(?:ql)?:\\/\\/[^\\s"\']+/gi,',
      '];',
    ].join('\n');

    expect(truncationOf(file('a.ts', source))).toBeUndefined();
  });

  it('accepts a file whose last line is a comment', () => {
    expect(truncationOf(file('a.ts', 'export const a = 1;\n// done'))).toBeUndefined();
  });

  it('leaves alone what it cannot judge', () => {
    // Markdown and images have no bracket structure to reason about.
    expect(truncationOf(file('README.md', 'A heading {'))).toBeUndefined();
    expect(
      truncationOf({
        path: 'public/generated/hero.png',
        content: '',
        language: 'binary',
        binary: { storageKey: 'k', contentType: 'image/png', bytes: 10 },
      }),
    ).toBeUndefined();
  });

  it('stays quiet when its own counting has gone wrong', () => {
    /*
     * A closer with no matching opener means this has lost track of something
     * — a generic, JSX text, syntax it does not model. Guessing further would
     * report finished files as truncated, which costs a model call each time.
     */
    expect(truncationOf(file('a.ts', 'const a = 1; }\nconst b = {\n'))).toBeUndefined();
  });
});
