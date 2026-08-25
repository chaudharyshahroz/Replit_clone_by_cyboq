import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import {
  describeSelection,
  elementId,
  instrumentForVisualSelection,
  resolveElement,
  VISUAL_SELECTION_BRIDGE,
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

/*
 * The bridge is a string until it reaches a browser, where nothing type-checks
 * it and a syntax error is invisible from here — it would ship inside every
 * generated application and break selection in all of them at once, with the
 * only symptom being a tool that does nothing when clicked.
 */
describe('attaching the bridge to a generated app', () => {
  const layout: GeneratedFile = {
    path: 'src/app/layout.tsx',
    language: 'tsx',
    content: [
      'export default function RootLayout({ children }) {',
      '  return (',
      '    <html lang="en">',
      '      <body>{children}</body>',
      '    </html>',
      '  );',
      '}',
    ].join('\n'),
  };

  /*
   * The ids and the script that reports them are one feature. Kept apart they
   * drifted in the worst possible way: every element carried an id, the source
   * map resolved all of them, and nothing ever sent one — because the script
   * was exported and injected into nothing. Every tool then pointed at a page
   * that was not listening, which is indistinguishable from a tool that does
   * nothing.
   */
  it('ships the script alongside the ids', () => {
    const result = instrumentForVisualSelection([layout]);

    const script = result.files.find((file) => file.path === 'public/reklu-bridge.js');
    expect(script?.content).toBe(VISUAL_SELECTION_BRIDGE);
  });

  it('links it from the layout', () => {
    const result = instrumentForVisualSelection([layout]);
    const written = result.files.find((file) => file.path === 'src/app/layout.tsx');

    expect(written?.content).toContain('src="/reklu-bridge.js"');
    expect(written?.content.indexOf('reklu-bridge.js')).toBeLessThan(
      written!.content.lastIndexOf('</body>'),
    );
  });

  it('does not add a second tag when run again', () => {
    const once = instrumentForVisualSelection([layout]).files;
    const twice = instrumentForVisualSelection(once).files;

    const written = twice.find((file) => file.path === 'src/app/layout.tsx')!;
    expect(written.content.split('reklu-bridge.js').length - 1).toBe(1);
    expect(twice.filter((file) => file.path === 'public/reklu-bridge.js')).toHaveLength(1);
  });

  it('replaces an older copy of the script', () => {
    /*
     * The reason it is a file and not an inline tag. An application generated
     * before a fix must pick the fix up on its next edit, rather than keeping
     * whatever the bridge said the week it was made.
     */
    const stale: GeneratedFile = {
      path: 'public/reklu-bridge.js',
      language: 'javascript',
      content: '/* an older bridge */',
    };

    const result = instrumentForVisualSelection([layout, stale]);
    const script = result.files.find((file) => file.path === 'public/reklu-bridge.js');

    expect(script?.content).toBe(VISUAL_SELECTION_BRIDGE);
    expect(result.files.filter((file) => file.path === 'public/reklu-bridge.js')).toHaveLength(1);
  });

  it('leaves an app it does not understand alone', () => {
    // A layout with no closing body tag is one this cannot place a tag inside,
    // and damaging a working application to add a script to it is not a trade.
    const odd: GeneratedFile = { path: 'src/app/layout.tsx', language: 'tsx', content: 'export {};' };
    const result = instrumentForVisualSelection([odd]);

    expect(result.files.find((file) => file.path === 'src/app/layout.tsx')?.content).toBe(
      'export {};',
    );
  });
});

describe('the visual selection bridge', () => {
  it('is valid JavaScript', () => {
    expect(() => new vm.Script(VISUAL_SELECTION_BRIDGE)).not.toThrow();
  });

  it('ignores messages that are not from the editor', () => {
    /*
     * The frame is addressable by anything that can reach it, so an unrecognised
     * sender must not be able to put it into a mode the person did not pick.
     */
    expect(VISUAL_SELECTION_BRIDGE).toContain("data.source !== 'reklu-editor'");
  });

  it('gathers text edits instead of sending each one', () => {
    /*
     * Fixing a heading and the paragraph under it is one thought and should be
     * one request. Sending on every blur would start a build per edit, each one
     * rewriting files the next is about to rewrite again.
     */
    expect(VISUAL_SELECTION_BRIDGE).toContain('pending[id]');
    expect(VISUAL_SELECTION_BRIDGE).toContain('send({ textChanges: changes })');
  });

  it('can put the retyped words back', () => {
    // Nothing has been written when text is cleared, so the page is the only
    // place the edit exists — and the only place it can be undone.
    expect(VISUAL_SELECTION_BRIDGE).toContain('function revertEdits()');
    expect(VISUAL_SELECTION_BRIDGE).toContain('pending[id].original');
  });

  it('leaves the page alone when no tool is held', () => {
    // Without this the framed app stops behaving like the app it is previewing.
    expect(VISUAL_SELECTION_BRIDGE).toContain("if (mode === 'off' && !event.altKey) return;");
  });
});
