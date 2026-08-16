/**
 * Detecting when a response is substantial enough to become an artifact
 * (spec §19–20).
 *
 * The judgement call: **false positives are worse than false negatives.**
 * Turning every three-paragraph answer into a document clutters the workspace
 * and trains users to ignore the panel. Missing one costs a click. So the
 * thresholds are deliberately conservative, and detection is heuristic and
 * deterministic — not a model call, which would be slow, costly, and
 * inconsistent between identical responses.
 */

export type DetectedArtifactType = 'document' | 'code' | 'spreadsheet';

export interface ArtifactCandidate {
  readonly type: DetectedArtifactType;
  readonly title: string;
  /** Why it qualified — surfaced in logs, useful when tuning thresholds. */
  readonly reason: string;
  /** The content to store, which may be a fenced block rather than the whole reply. */
  readonly content: string;
  readonly language?: string;
}

/** A reply shorter than this is conversation, not a deliverable. */
const MIN_DOCUMENT_CHARS = 1_200;
const MIN_CODE_LINES = 20;
const MIN_TABLE_ROWS = 4;

interface FencedBlock {
  readonly language: string;
  readonly code: string;
  readonly lines: number;
}

/** Extract fenced code blocks, tolerating an unterminated final fence. */
export function extractCodeBlocks(markdown: string): readonly FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const pattern = /```([\w+-]*)\n([\s\S]*?)(?:```|$)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const code = match[2] ?? '';
    if (code.trim().length === 0) continue;
    blocks.push({
      language: (match[1] || 'text').toLowerCase(),
      code: code.replace(/\n+$/, ''),
      lines: code.trim().split('\n').length,
    });
  }
  return blocks;
}

/** Count markdown table rows (excluding the separator line). */
function countTableRows(markdown: string): number {
  const lines = markdown.split('\n');
  let rows = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    // Separator rows look like |---|---|
    if (/^\|[\s:-]+\|$/.test(trimmed.replace(/[^|\s:-]/g, ''))) continue;
    rows++;
  }
  return rows;
}

function countHeadings(markdown: string): number {
  return (markdown.match(/^#{1,4}\s+\S/gm) ?? []).length;
}

/**
 * Derive a title.
 *
 * Prefers the first heading, since a model that wrote one already chose a name.
 * Falls back to the first meaningful sentence, then to a generic label.
 */
export function deriveTitle(markdown: string, fallback: string): string {
  const heading = /^#{1,4}\s+(.+)$/m.exec(markdown);
  if (heading?.[1]) return clean(heading[1]);

  // Strip fenced regions entirely — searching line-by-line picked up a line of
  // code, which is never a good title.
  const prose = markdown.replace(/```[\s\S]*?(?:```|$)/g, '');
  const firstLine = prose
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('|'));

  if (firstLine) {
    const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
    if (sentence.length >= 8) return clean(sentence);
  }
  return fallback;
}

function clean(text: string): string {
  return text
    .replace(/[*_`#]/g, '')
    .trim()
    .slice(0, 80)
    .replace(/[\s,;:.-]+$/, '');
}

/**
 * Decide whether a reply is artifact-worthy.
 *
 * Returns undefined for ordinary conversation, which is the common case.
 */
export function detectArtifact(markdown: string): ArtifactCandidate | undefined {
  const text = markdown.trim();
  if (text.length === 0) return undefined;

  // ---- Code -------------------------------------------------------------
  // A single substantial block is a file the user probably wants to keep.
  const blocks = extractCodeBlocks(text);
  const largest = [...blocks].sort((a, b) => b.lines - a.lines)[0];

  if (largest && largest.lines >= MIN_CODE_LINES) {
    // Prose wrapped around one big block is still primarily code, unless the
    // prose itself is long enough to be the deliverable.
    const proseLength = text.replace(/```[\s\S]*?(?:```|$)/g, '').trim().length;
    if (proseLength < largest.code.length) {
      return {
        type: 'code',
        title: deriveTitle(text, `Code (${largest.language})`),
        reason: `${largest.lines}-line ${largest.language} block`,
        content: largest.code,
        language: largest.language,
      };
    }
  }

  const tableRows = countTableRows(text);
  const headings = countHeadings(text);

  // ---- Document ---------------------------------------------------------
  // Checked before spreadsheet: a report that happens to contain a table is a
  // document, not a spreadsheet. Long *and* structured — length alone catches
  // rambling answers; structure means the model actually organised something.
  if (text.length >= MIN_DOCUMENT_CHARS && (headings >= 2 || tableRows >= MIN_TABLE_ROWS)) {
    return {
      type: 'document',
      title: deriveTitle(text, 'Document'),
      reason: `${text.length} chars, ${headings} headings, ${tableRows} table rows`,
      content: text,
    };
  }

  // ---- Spreadsheet ------------------------------------------------------
  // A table is a spreadsheet when the table essentially *is* the reply. If
  // substantial prose surrounds it, it is illustrating a point, not data to keep.
  if (tableRows >= MIN_TABLE_ROWS) {
    const proseOutsideTable = text
      .split('\n')
      .filter((line) => !line.trim().startsWith('|'))
      .join(' ')
      .trim();

    if (proseOutsideTable.length < 400) {
      return {
        type: 'spreadsheet',
        title: deriveTitle(text, 'Table'),
        reason: `${tableRows}-row table`,
        content: text,
      };
    }
  }

  return undefined;
}
