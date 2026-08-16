/**
 * Citation integrity (spec §24).
 *
 * The rule: **a citation may only reference a source Reklu actually
 * retrieved.** A model asked to cite will occasionally emit `[7]` when six
 * sources exist, or cite a source it never read. Rendering that as a live
 * footnote is worse than omitting it — it manufactures the appearance of
 * evidence, which is precisely the failure that makes AI research untrustworthy.
 *
 * So every marker in a generated report is validated against the retrieved set.
 * Markers that do not resolve are **stripped from the prose**, not rendered as
 * broken links, and the discrepancy is reported so it can be surfaced and
 * logged rather than hidden.
 */

export interface CitationMarker {
  /** The number as written, e.g. 7 for `[7]`. */
  readonly index: number;
  /** Character offset of the marker within the report. */
  readonly offset: number;
  readonly raw: string;
}

/**
 * Find `[n]` and `[n, m]` markers.
 *
 * Deliberately narrow: only bracketed digits. Markdown links `[text](url)` and
 * checkboxes `[x]` must not be mistaken for citations.
 */
export function parseCitationMarkers(report: string): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  const pattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(report)) !== null) {
    // `[1](https://…)` is a markdown link, not a citation.
    if (report[match.index + match[0].length] === '(') continue;

    for (const part of match[1]!.split(',')) {
      const index = Number(part.trim());
      if (Number.isInteger(index) && index > 0) {
        markers.push({ index, offset: match.index, raw: match[0] });
      }
    }
  }
  return markers;
}

export interface CitationValidation {
  /** Markers resolving to a retrieved source. */
  readonly valid: readonly CitationMarker[];
  /** Markers with no corresponding source — the model invented these. */
  readonly fabricated: readonly CitationMarker[];
  /** Sources retrieved but never cited. Not an error; useful for the panel. */
  readonly uncitedSourceIndexes: readonly number[];
  /** True when the report cited nothing at all despite sources existing. */
  readonly citedNothing: boolean;
}

/**
 * Validate markers against the sources actually retrieved.
 *
 * `availableCount` is the number of sources that were fetched **successfully** —
 * a source that failed to fetch cannot support a claim, so citing it is
 * fabrication just as surely as citing one that never existed.
 */
export function validateCitations(
  report: string,
  availableCount: number,
): CitationValidation {
  const markers = parseCitationMarkers(report);

  const valid: CitationMarker[] = [];
  const fabricated: CitationMarker[] = [];
  const cited = new Set<number>();

  for (const marker of markers) {
    if (marker.index >= 1 && marker.index <= availableCount) {
      valid.push(marker);
      cited.add(marker.index);
    } else {
      fabricated.push(marker);
    }
  }

  const uncitedSourceIndexes: number[] = [];
  for (let index = 1; index <= availableCount; index++) {
    if (!cited.has(index)) uncitedSourceIndexes.push(index);
  }

  return {
    valid,
    fabricated,
    uncitedSourceIndexes,
    citedNothing: availableCount > 0 && cited.size === 0,
  };
}

/**
 * Remove markers that do not resolve to a retrieved source.
 *
 * Tidies the punctuation left behind so the prose does not end up with
 * `evidence  .` or `a, , b`.
 */
export function stripFabricatedCitations(report: string, availableCount: number): string {
  let cleaned = report.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (raw, group: string) => {
    const kept = group
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((index) => Number.isInteger(index) && index >= 1 && index <= availableCount);

    return kept.length === 0 ? '' : `[${kept.join(', ')}]`;
  });

  return tidyAfterRemoval(cleaned);
}

/**
 * Repair the whitespace a removed marker leaves behind.
 *
 * Shared by both removal paths — they produced subtly different results when
 * each had its own cleanup, which is exactly how "Revenue rose 40% ." reaches
 * a user.
 */
function tidyAfterRemoval(text: string): string {
  return (
    text
      // Space left before punctuation: "grew [9]." -> "grew ." -> "grew."
      .replace(/[ \t]+([.,;:!?)\]])/g, '$1')
      // Doubled spaces mid-line, without touching indentation or newlines.
      .replace(/([^\n ]) {2,}(?=[^\n ])/g, '$1 ')
      // Trailing whitespace at end of line, which a marker at line end leaves.
      .replace(/[ \t]+$/gm, '')
  );
}

export interface ClaimCitation {
  /** The sentence the marker appeared in. */
  readonly claim: string;
  readonly sourceIndex: number;
  readonly offset: number;
}

/**
 * Pair each valid marker with the sentence it supports.
 *
 * Storing the claim — not just the source id — is what makes a citation
 * checkable later: a reviewer can ask whether the source actually says this.
 */
export function extractClaimCitations(
  report: string,
  availableCount: number,
): readonly ClaimCitation[] {
  const { valid } = validateCitations(report, availableCount);
  const results: ClaimCitation[] = [];

  for (const marker of valid) {
    results.push({
      claim: sentenceAround(report, marker.offset),
      sourceIndex: marker.index,
      offset: marker.offset,
    });
  }
  return results;
}

/** The sentence containing a given offset, trimmed of citation markers. */
function sentenceAround(text: string, offset: number): string {
  // Walk back to the previous sentence end or newline.
  let start = 0;
  for (let i = Math.min(offset, text.length - 1); i > 0; i--) {
    const char = text[i];
    if (char === '\n') {
      start = i + 1;
      break;
    }
    if ((char === '.' || char === '!' || char === '?') && /\s/.test(text[i + 1] ?? ' ')) {
      start = i + 1;
      break;
    }
  }

  // Walk forward to the next sentence end or newline.
  let end = text.length;
  for (let i = offset; i < text.length; i++) {
    const char = text[i];
    if (char === '\n') {
      end = i;
      break;
    }
    if ((char === '.' || char === '!' || char === '?') && /\s/.test(text[i + 1] ?? ' ')) {
      end = i + 1;
      break;
    }
  }

  const withoutMarkers = text
    .slice(start, end)
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, '');

  // Collapse newlines first, then run the same tidy-up as the stripper so both
  // paths agree on what a cleaned sentence looks like.
  return tidyAfterRemoval(withoutMarkers.replace(/\s*\n\s*/g, ' ')).trim();
}
