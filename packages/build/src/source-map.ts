/**
 * Component source mapping for visual selection (spec §35).
 *
 * The goal: a user clicks an element in the preview and Reklu knows which
 * source range produced it.
 *
 * Spec §35 says the *architecture* must support this even if the first version
 * of visual editing is limited — and that is the important part. Retrofitting
 * it later would mean regenerating every existing project, because the mapping
 * has to be baked in at generation time.
 *
 * So: stable `data-reklu-id` attributes are injected into generated JSX, and a
 * map from id → file + line is stored alongside the tree. Clicking an element
 * resolves through that map; nothing has to guess.
 */
import { createHash } from 'node:crypto';
import type { GeneratedFile } from './parse';

export interface SourceLocation {
  readonly file: string;
  /** 1-indexed line in the generated file. */
  readonly line: number;
  /** The element tag, for a readable label in the UI. */
  readonly tag: string;
}

export type SourceMap = Readonly<Record<string, SourceLocation>>;

/** Files whose JSX is worth instrumenting. */
const JSX_EXTENSIONS = new Set(['tsx', 'jsx']);

/** Elements never instrumented — instrumenting these breaks the document. */
const SKIPPED_TAGS = new Set(['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title']);

/**
 * A stable id for an element.
 *
 * Derived from file, line and tag rather than a counter, so regenerating an
 * unchanged file produces the same ids and a selection survives a rebuild.
 */
export function elementId(file: string, line: number, tag: string): string {
  return createHash('sha256')
    .update(`${file}:${line}:${tag}`)
    .digest('base64url')
    .slice(0, 10);
}

export interface InstrumentResult {
  readonly files: readonly GeneratedFile[];
  readonly sourceMap: SourceMap;
  readonly instrumentedCount: number;
}

/**
 * Inject `data-reklu-id` into opening JSX tags.
 *
 * Deliberately conservative: only lines whose opening tag is unambiguous are
 * touched. A missed element costs a click-to-edit opportunity; a corrupted
 * generated file costs the whole build, so ambiguity is skipped rather than
 * guessed at.
 */
export function instrumentForVisualSelection(
  files: readonly GeneratedFile[],
): InstrumentResult {
  const sourceMap: Record<string, SourceLocation> = {};
  let instrumentedCount = 0;

  const instrumented = files.map((file) => {
    const extension = file.path.split('.').pop()?.toLowerCase() ?? '';
    if (!JSX_EXTENSIONS.has(extension)) return file;

    const lines = file.content.split('\n');

    const rewritten = lines.map((line, index) => {
      // A single opening tag with a lowercase (host) element name. Component
      // tags are capitalised and their internals are instrumented where they
      // are defined, so instrumenting the usage would double-count.
      const match = /^(\s*)<([a-z][a-zA-Z0-9-]*)(\s|>|$)/.exec(line);
      if (!match) return line;

      const tag = match[2]!;
      if (SKIPPED_TAGS.has(tag)) return line;
      // Already instrumented, or self-closing with no attribute slot.
      if (line.includes('data-reklu-id')) return line;

      const id = elementId(file.path, index + 1, tag);
      sourceMap[id] = { file: file.path, line: index + 1, tag };
      instrumentedCount++;

      // Insert immediately after the tag name, which is always a valid
      // attribute position.
      const insertAt = (match[1]?.length ?? 0) + 1 + tag.length;
      return `${line.slice(0, insertAt)} data-reklu-id="${id}"${line.slice(insertAt)}`;
    });

    return { ...file, content: rewritten.join('\n') };
  });

  return { files: instrumented, sourceMap, instrumentedCount };
}

/**
 * The bridge script injected into a generated app.
 *
 * Posts the clicked element's id to the parent frame. Kept tiny and
 * dependency-free, and it only ever sends an id — never page content — so a
 * generated app cannot use it to exfiltrate anything to Reklu's origin.
 */
export const VISUAL_SELECTION_BRIDGE = `
// Reklu visual selection bridge. Sends only the clicked element's id.
(function () {
  if (window.__rekluBridge) return;
  window.__rekluBridge = true;

  document.addEventListener('click', function (event) {
    if (!event.altKey) return; // Alt+click selects, so normal clicks still work
    var node = event.target;
    while (node && node !== document.body) {
      var id = node.getAttribute && node.getAttribute('data-reklu-id');
      if (id) {
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage({ source: 'reklu-preview', elementId: id }, '*');
        return;
      }
      node = node.parentElement;
    }
  }, true);
})();
`.trim();

/** Resolve a clicked element back to its source location. */
export function resolveElement(
  sourceMap: SourceMap,
  elementIdentifier: string,
): SourceLocation | undefined {
  return sourceMap[elementIdentifier];
}

/**
 * Describe a selection for the edit prompt.
 *
 * Gives the model the file, the line, and the surrounding code, so "make this
 * card smaller" resolves to a specific place rather than a search.
 */
export function describeSelection(
  location: SourceLocation,
  files: readonly GeneratedFile[],
  contextLines = 6,
): string {
  const file = files.find((candidate) => candidate.path === location.file);
  if (!file) return `${location.file}:${location.line} (<${location.tag}>)`;

  const lines = file.content.split('\n');
  const start = Math.max(0, location.line - 1 - contextLines);
  const end = Math.min(lines.length, location.line + contextLines);

  return [
    `The user selected the <${location.tag}> element at ${location.file}:${location.line}.`,
    '',
    'Surrounding code:',
    '```',
    ...lines.slice(start, end).map((line, index) => {
      const number = start + index + 1;
      const marker = number === location.line ? '>' : ' ';
      return `${marker} ${number} | ${line}`;
    }),
    '```',
  ].join('\n');
}
