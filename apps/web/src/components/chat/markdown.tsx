'use client';

import { useMemo } from 'react';
import { Citation } from './citation';
import type { CitedSource } from '@/lib/citations';

/**
 * Markdown rendering for assistant messages (spec §14).
 *
 * A deliberately small, dependency-free renderer covering what models actually
 * emit: headings, lists, code blocks, inline code, bold, italic, links, and
 * blockquotes.
 *
 * The security property that matters: this parses into **React elements**, not
 * HTML strings. There is no `dangerouslySetInnerHTML` anywhere, so model output
 * — which is untrusted text — cannot inject markup or script no matter what it
 * contains. Link hrefs are additionally restricted to http/https/mailto, which
 * blocks `javascript:` URLs.
 */

type Inline = string | { readonly kind: 'code' | 'bold' | 'italic'; readonly text: string } | {
  readonly kind: 'link';
  readonly text: string;
  readonly href: string;
};

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

function safeHref(raw: string): string | undefined {
  const trimmed = raw.trim();
  // Relative links are fine; anything with a scheme must be on the allowlist.
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  return SAFE_PROTOCOL.test(trimmed) ? trimmed : undefined;
}

/** Tokenize a line's inline markup. Order matters: code wins over emphasis. */
function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    const token = match[0];

    if (token.startsWith('`')) {
      out.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = linkMatch ? safeHref(linkMatch[2]!) : undefined;
      if (linkMatch && href) {
        out.push({ kind: 'link', text: linkMatch[1]!, href });
      } else {
        // Unsafe or malformed link: render the literal text, never a live link.
        out.push(token);
      }
    } else if (token.startsWith('**')) {
      out.push({ kind: 'bold', text: token.slice(2, -2) });
    } else {
      out.push({ kind: 'italic', text: token.slice(1, -1) });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

/**
 * Citation markers, removed.
 *
 * A table cell is a few words wide. Three source chips inside one turn it into
 * a column of badges with the fact buried among them — the table stops being
 * scannable, which is the only reason to use a table. The prose around it
 * carries the citations; the cell carries the fact.
 */
function withoutCitations(text: string): string {
  return text
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function InlineRun({
  text,
  sources,
}: {
  text: string;
  sources?: Map<number, CitedSource>;
}) {
  const parts = parseInline(text);
  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === 'string') return <span key={index}>{part}</span>;
        switch (part.kind) {
          case 'code':
            return (
              <code
                key={index}
                className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.9em] text-text"
              >
                {part.text}
              </code>
            );
          case 'bold':
            return (
              <strong key={index} className="font-semibold text-text">
                {part.text}
              </strong>
            );
          case 'italic':
            return (
              <em key={index} className="italic">
                {part.text}
              </em>
            );
          case 'link': {
            /**
             * A link whose text is only a number is a citation, not prose.
             *
             * Research writes `[1]` markers and the view turns each into a link
             * to the source it refers to. Rendered as an underlined inline link
             * those markers break the sentence they sit in; as a small raised
             * pill they read the way a footnote should — present, checkable,
             * and out of the way.
             */
            const isCitation = /^\d+(?:\s*,\s*\d+)*$/.test(part.text);

            if (isCitation) {
              // A grouped marker previews the first source it names, which is
              // the one its link goes to.
              const first = Number(part.text.split(',')[0]!.trim());
              return (
                <Citation
                  key={index}
                  label={part.text}
                  href={part.href}
                  source={sources?.get(first)}
                />
              );
            }

            return (
              <a
                key={index}
                href={part.href}
                target="_blank"
                // noreferrer also prevents the target learning the opener.
                rel="noopener noreferrer nofollow"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                {part.text}
              </a>
            );
          }
        }
      })}
    </>
  );
}

type Block =
  | { readonly kind: 'paragraph'; readonly lines: string[] }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | {
      readonly kind: 'table';
      readonly header: string[];
      readonly rows: string[][];
    }
  | { readonly kind: 'code'; readonly language: string; readonly code: string }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: string[];
      /** The number the author wrote, so a split list keeps counting. */
      readonly start: number;
    }
  | { readonly kind: 'quote'; readonly lines: string[] }
  | { readonly kind: 'rule' };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    // Fenced code. An unterminated fence (common mid-stream) still renders.
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!.trim())) {
        body.push(lines[index]!);
        index++;
      }
      index++; // consume closing fence if present
      blocks.push({ kind: 'code', language, code: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      index++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      index++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^\s*>\s?/, ''));
        index++;
      }
      blocks.push({ kind: 'quote', lines: quote });
      continue;
    }

    /**
     * A markdown table.
     *
     * Recognised by its separator row rather than by the pipes alone: a
     * sentence containing a `|` is not a table, and the `---|---` line is the
     * only unambiguous signal. Without this the whole thing rendered as
     * paragraphs of pipe characters, which is why comparisons came back as
     * prose instead.
     */
    const tableRow = /^\s*\|.*\|\s*$/;
    const tableRule = /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/;

    if (tableRow.test(line) && index + 1 < lines.length && tableRule.test(lines[index + 1]!)) {
      const cells = (row: string): string[] =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => cell.trim());

      const header = cells(line);
      index += 2;

      const rows: string[][] = [];
      while (index < lines.length && tableRow.test(lines[index]!)) {
        rows.push(cells(lines[index]!));
        index++;
      }

      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      const matcher = ordered ? numbered : bullet;

      /**
       * Where an ordered list starts counting.
       *
       * Only consecutive matching lines form one list, and models routinely
       * write `1. Idea` followed by indented bullets, then `2. Idea`. Each
       * number therefore opens a *new* <ol> — and every <ol> restarts at one,
       * so a ten-item list rendered as "1." ten times.
       *
       * Carrying the author's own number across fixes it without trying to
       * merge blocks that are genuinely separate.
       */
      const start = ordered ? Number(/\d+/.exec(line)?.[0] ?? 1) : 1;

      while (index < lines.length && matcher.test(lines[index]!)) {
        items.push(lines[index]!.replace(matcher, ''));
        index++;
      }
      blocks.push({ kind: 'list', ordered, items, start });
      continue;
    }

    if (line.trim() === '') {
      index++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[index]!) &&
      !/^```/.test(lines[index]!.trim()) &&
      !bullet.test(lines[index]!) &&
      !numbered.test(lines[index]!) &&
      !/^\s*>\s?/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index++;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
}

export function Markdown({
  content,
  citations,
}: {
  content: string;
  /** Sources behind [n] markers, so each one can show what it points at. */
  citations?: readonly CitedSource[];
}) {
  // Streaming re-renders this on every delta; parsing is cheap but memoizing
  // keeps it off the critical path for long messages.
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const sourcesByIndex = useMemo(
    () => new Map((citations ?? []).map((source) => [source.index, source])),
    [citations],
  );

  return (
    <div className="space-y-3 leading-relaxed text-text">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'table':
            return (
              // Wide tables scroll inside their own container so the message
              // never pushes the conversation sideways.
              <div key={index} className="my-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-strong">
                      {block.header.map((cell, cellIndex) => (
                        <th
                          key={cellIndex}
                          scope="col"
                          className="px-3 py-2 font-medium text-text"
                        >
                          <InlineRun text={withoutCitations(cell)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-border last:border-0">
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="px-3 py-2 align-top text-text-secondary"
                          >
                            <InlineRun text={withoutCitations(cell)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'heading': {
            /**
             * Headings need to win against the body text around them.
             *
             * A research answer is mostly dense bullets, and at the previous
             * weights a section title read as another sentence — there was
             * nothing to scan by. More size, more weight, and space above that
             * separates sections rather than merely indenting them.
             */
            const sizes = [
              'text-2xl tracking-tight',
              'text-xl tracking-tight',
              'text-lg',
              'text-base',
            ];
            const spacing = ['mt-8', 'mt-7', 'mt-6', 'mt-5'];
            const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1] ?? 'h4';
            return (
              <Tag
                key={index}
                className={`mb-2 font-semibold text-text ${
                  spacing[block.level - 1] ?? 'mt-5'
                } ${sizes[block.level - 1] ?? 'text-base'} first:mt-0`}
              >
                <InlineRun sources={sourcesByIndex} text={block.text} />
              </Tag>
            );
          }

          case 'code':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg border border-border bg-surface p-4"
              >
                <code className="font-mono text-[0.8125rem] leading-relaxed text-text-secondary">
                  {block.code}
                </code>
              </pre>
            );

          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            const startAt = block.ordered && block.start > 1 ? { start: block.start } : {};
            return (
              <Tag
                key={index}
                {...startAt}
                className={`space-y-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-text-muted`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineRun sources={sourcesByIndex} text={item} />
                  </li>
                ))}
              </Tag>
            );
          }

          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-border-strong pl-4 text-text-secondary"
              >
                <InlineRun sources={sourcesByIndex} text={block.lines.join(' ')} />
              </blockquote>
            );

          case 'rule':
            return <hr key={index} className="border-border" />;

          case 'paragraph':
            return (
              <p key={index}>
                <InlineRun sources={sourcesByIndex} text={block.lines.join('\n')} />
              </p>
            );
        }
      })}
    </div>
  );
}
