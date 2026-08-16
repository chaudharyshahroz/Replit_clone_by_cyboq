import { describe, expect, it } from 'vitest';
import {
  describeSelection,
  elementId,
  instrumentForVisualSelection,
  resolveElement,
} from '../source-map';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: path.endsWith('tsx') ? 'tsx' : 'typescript',
});

const page = file(
  'src/app/page.tsx',
  [
    'export default function Page() {',
    '  return (',
    '    <div className="wrapper">',
    '      <h1>Title</h1>',
    '      <p>Body text</p>',
    '    </div>',
    '  );',
    '}',
  ].join('\n'),
);

describe('elementId', () => {
  // Stable ids mean a selection survives a rebuild of an unchanged file.
  it('is stable for the same location', () => {
    expect(elementId('a.tsx', 3, 'div')).toBe(elementId('a.tsx', 3, 'div'));
  });

  it('differs by file, line and tag', () => {
    expect(elementId('a.tsx', 3, 'div')).not.toBe(elementId('b.tsx', 3, 'div'));
    expect(elementId('a.tsx', 3, 'div')).not.toBe(elementId('a.tsx', 4, 'div'));
    expect(elementId('a.tsx', 3, 'div')).not.toBe(elementId('a.tsx', 3, 'p'));
  });

  it('is URL-safe and short', () => {
    expect(elementId('a.tsx', 1, 'div')).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
});

describe('instrumentForVisualSelection', () => {
  it('injects ids into host elements', () => {
    const result = instrumentForVisualSelection([page]);
    const content = result.files[0]!.content;

    expect(content).toContain('<div data-reklu-id=');
    expect(content).toContain('<h1 data-reklu-id=');
    expect(content).toContain('<p data-reklu-id=');
    expect(result.instrumentedCount).toBe(3);
  });

  it('preserves existing attributes', () => {
    const content = instrumentForVisualSelection([page]).files[0]!.content;
    expect(content).toContain('className="wrapper"');
  });

  it('records a source location per id', () => {
    const result = instrumentForVisualSelection([page]);
    const entries = Object.values(result.sourceMap);

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.tag).sort()).toEqual(['div', 'h1', 'p']);
    for (const entry of entries) {
      expect(entry.file).toBe('src/app/page.tsx');
      expect(entry.line).toBeGreaterThan(0);
    }
  });

  it('leaves non-JSX files untouched', () => {
    const ts = file('src/lib.ts', 'export const x = 1;');
    const result = instrumentForVisualSelection([ts]);
    expect(result.files[0]!.content).toBe('export const x = 1;');
    expect(result.instrumentedCount).toBe(0);
  });

  // Instrumenting these breaks the document.
  it('skips document-level tags', () => {
    const doc = file('src/layout.tsx', '    <html>\n    <body>\n    <script>');
    expect(instrumentForVisualSelection([doc]).instrumentedCount).toBe(0);
  });

  // Component internals are instrumented where they are defined.
  it('skips capitalised component tags', () => {
    const usage = file('src/a.tsx', '    <MyCard />\n    <Button>');
    expect(instrumentForVisualSelection([usage]).instrumentedCount).toBe(0);
  });

  it('is idempotent', () => {
    const once = instrumentForVisualSelection([page]);
    const twice = instrumentForVisualSelection(once.files);

    expect(twice.files[0]!.content).toBe(once.files[0]!.content);
    expect(twice.instrumentedCount).toBe(0);
  });

  /**
   * A missed element costs a click-to-edit opportunity; a corrupted file costs
   * the whole build. Ambiguity is skipped, not guessed at.
   */
  it('skips lines where the opening tag is ambiguous', () => {
    const inline = file('src/a.tsx', '    return <div><span>text</span></div>;');
    const result = instrumentForVisualSelection([inline]);
    expect(result.files[0]!.content).toBe(inline.content);
  });

  it('produces ids that resolve through the map', () => {
    const result = instrumentForVisualSelection([page]);
    const id = /data-reklu-id="([^"]+)"/.exec(result.files[0]!.content)?.[1];

    expect(id).toBeDefined();
    expect(resolveElement(result.sourceMap, id!)).toBeDefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveElement({}, 'nope')).toBeUndefined();
  });
});

describe('describeSelection', () => {
  it('names the element and shows surrounding code', () => {
    const description = describeSelection(
      { file: 'src/app/page.tsx', line: 4, tag: 'h1' },
      [page],
    );

    expect(description).toContain('<h1>');
    expect(description).toContain('src/app/page.tsx:4');
    expect(description).toContain('Title');
    // The selected line is marked so the model knows which one is meant.
    expect(description).toContain('> 4 |');
  });

  it('degrades gracefully when the file is missing', () => {
    const description = describeSelection({ file: 'gone.tsx', line: 2, tag: 'div' }, []);
    expect(description).toContain('gone.tsx:2');
  });

  it('clamps context at the start of a file', () => {
    expect(() =>
      describeSelection({ file: 'src/app/page.tsx', line: 1, tag: 'div' }, [page]),
    ).not.toThrow();
  });
});
