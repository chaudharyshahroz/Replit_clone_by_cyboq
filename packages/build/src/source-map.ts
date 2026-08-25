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
 * Reports which element was picked, and nothing else. It sends an id — never
 * text, never markup — so a generated app cannot use the channel to hand page
 * content to Reklu's origin. The one exception is the text tool, where the
 * replacement text *is* the instruction and the person typed it themselves.
 *
 * The parent drives it by posting `{ source: 'reklu-editor', mode }`. Modes are
 * exclusive, and `off` is the default: with no tool held, the generated app
 * behaves exactly as it will in production — links follow, buttons fire — which
 * is what makes the preview a preview rather than an editor that happens to
 * render.
 */
export const VISUAL_SELECTION_BRIDGE = `
// Reklu visual selection bridge. Sends element ids, never page content.
(function () {
  if (window.__rekluBridge) return;
  window.__rekluBridge = true;

  var mode = 'off';
  var editing = null;
  // Retyped text, held here until it is sent. Keyed by element id so correcting
  // the same heading twice is one change, not two.
  var pending = {};

  // Drawn by us rather than by outlining the element itself: a real outline
  // changes layout on anything sized to its border box, so hovering would nudge
  // the page it is meant to be inspecting.
  var halo = document.createElement('div');
  halo.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' +
    'border:2px solid #6366f1;border-radius:3px;display:none;' +
    'box-shadow:0 0 0 9999px rgba(15,23,42,.10);transition:all .06s ease-out';
  var tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
    'background:#6366f1;color:#fff;font:500 11px/1.4 ui-sans-serif,system-ui,sans-serif;' +
    'padding:2px 6px;border-radius:4px;white-space:nowrap';

  function mount() {
    if (!halo.parentNode && document.body) {
      document.body.appendChild(halo);
      document.body.appendChild(tip);
    }
  }

  function owner(node) {
    while (node && node !== document.documentElement) {
      if (node.getAttribute && node.getAttribute('data-reklu-id')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function frame(node) {
    if (!node) { halo.style.display = 'none'; tip.style.display = 'none'; return; }
    mount();
    var box = node.getBoundingClientRect();
    halo.style.display = 'block';
    halo.style.left = box.left + 'px';
    halo.style.top = box.top + 'px';
    halo.style.width = box.width + 'px';
    halo.style.height = box.height + 'px';
    tip.style.display = 'block';
    tip.textContent = node.tagName.toLowerCase();
    // Flipped below the element when it is against the top of the viewport,
    // where a label above it would be off-screen.
    tip.style.top = (box.top > 22 ? box.top - 20 : box.bottom + 4) + 'px';
    tip.style.left = Math.max(4, box.left) + 'px';
  }

  function send(payload) {
    payload.source = 'reklu-preview';
    parent.postMessage(payload, '*');
  }

  document.addEventListener('mousemove', function (event) {
    if (mode !== 'select' && mode !== 'text') return;
    frame(owner(event.target));
  }, true);

  document.addEventListener('mouseleave', function () { frame(null); }, true);

  // Capture phase, so a tool takes the click before the app's own handler does.
  document.addEventListener('click', function (event) {
    if (mode === 'off' && !event.altKey) return;
    var node = owner(event.target);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();

    if (mode === 'text') {
      startEditing(node);
      return;
    }
    send({ elementId: node.getAttribute('data-reklu-id'), tag: node.tagName.toLowerCase() });
  }, true);

  function report() {
    var changes = [];
    for (var id in pending) {
      if (Object.prototype.hasOwnProperty.call(pending, id)) {
        changes.push({ elementId: id, tag: pending[id].tag, text: pending[id].text });
      }
    }
    send({ textChanges: changes });
  }

  function startEditing(node) {
    finishEditing(false);
    editing = { node: node, original: node.innerHTML };
    node.setAttribute('contenteditable', 'plaintext-only');
    node.focus();
    var range = document.createRange();
    range.selectNodeContents(node);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    frame(null);
  }

  function finishEditing(keep) {
    if (!editing) return;
    var node = editing.node;
    var original = editing.original;
    editing = null;
    node.removeAttribute('contenteditable');
    var text = (node.textContent || '').trim();

    if (!keep) {
      node.innerHTML = original;
      return;
    }

    // Left on the page rather than reverted. The point of typing in place is
    // seeing it in place; putting the old words back the instant you finish
    // would make every edit look like it had failed.
    var id = node.getAttribute('data-reklu-id');
    if (!pending[id]) pending[id] = { original: original, tag: node.tagName.toLowerCase() };
    pending[id].text = text.slice(0, 500);

    // The only case where typed text crosses the frame — and it is the person's
    // own words, which is the whole instruction.
    report();
  }

  // Put the page back the way the code says it is. The edits were only ever
  // shown here; nothing has been written, so there is nothing to undo but this.
  function revertEdits() {
    finishEditing(false);
    for (var id in pending) {
      if (Object.prototype.hasOwnProperty.call(pending, id)) {
        var node = document.querySelector('[data-reklu-id="' + id + '"]');
        if (node) node.innerHTML = pending[id].original;
      }
    }
    pending = {};
    report();
  }

  document.addEventListener('keydown', function (event) {
    if (!editing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finishEditing(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing(false);
    }
  }, true);

  document.addEventListener('focusout', function () {
    if (editing) finishEditing(true);
  }, true);

  // What sits under a drawn box. The parent draws over the frame — it cannot
  // see into the document — so it sends the box and asks what is beneath it.
  function underRegion(box) {
    var x = (box.x + box.width / 2) * window.innerWidth;
    var y = (box.y + box.height / 2) * window.innerHeight;
    var node = owner(document.elementFromPoint(x, y));
    // Climb until the element is at least as large as what was circled: the
    // point at the centre may land on one word of a section that was drawn
    // around whole.
    var wanted = box.width * window.innerWidth * box.height * window.innerHeight * 0.5;
    while (node) {
      var rect = node.getBoundingClientRect();
      if (rect.width * rect.height >= wanted) break;
      var next = owner(node.parentElement);
      if (!next) break;
      node = next;
    }
    if (!node) return;
    send({ elementId: node.getAttribute('data-reklu-id'), tag: node.tagName.toLowerCase() });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'reklu-editor') return;
    if (data.region) { underRegion(data.region); return; }
    if (data.revert) { revertEdits(); return; }
    if (typeof data.mode !== 'string') return;
    finishEditing(true);
    mode = data.mode;
    frame(null);
    document.documentElement.style.cursor =
      mode === 'select' ? 'crosshair' : mode === 'text' ? 'text' : '';
  });
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
