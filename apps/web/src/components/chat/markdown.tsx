'use client';

import { useMemo } from 'react';

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

function InlineRun({ text }: { text: string }) {
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
          case 'link':
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
      })}
    </>
  );
}

type Block =
  | { readonly kind: 'paragraph'; readonly lines: string[] }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly code: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: string[] }
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

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      const matcher = ordered ? numbered : bullet;
      while (index < lines.length && matcher.test(lines[index]!)) {
        items.push(lines[index]!.replace(matcher, ''));
        index++;
      }
      blocks.push({ kind: 'list', ordered, items });
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

export function Markdown({ content }: { content: string }) {
  // Streaming re-renders this on every delta; parsing is cheap but memoizing
  // keeps it off the critical path for long messages.
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-3 leading-relaxed text-text">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm'];
            const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[block.level - 1] ?? 'h4';
            return (
              <Tag
                key={index}
                className={`mt-5 font-semibold text-text ${sizes[block.level - 1] ?? 'text-sm'}`}
              >
                <InlineRun text={block.text} />
              </Tag>
            );
          }

          case 'code':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-lg border border-border bg-surface p-4"
              >
                <code className="font-mono text-[13px] leading-relaxed text-text-secondary">
                  {block.code}
                </code>
              </pre>
            );

          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={index}
                className={`space-y-1.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-text-muted`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineRun text={item} />
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
                <InlineRun text={block.lines.join(' ')} />
              </blockquote>
            );

          case 'rule':
            return <hr key={index} className="border-border" />;

          case 'paragraph':
            return (
              <p key={index}>
                <InlineRun text={block.lines.join('\n')} />
              </p>
            );
        }
      })}
    </div>
  );
}
