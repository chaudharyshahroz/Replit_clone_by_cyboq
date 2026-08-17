/**
 * Exporting artifacts to formats people actually send (spec §42–§43).
 *
 * PPTX and DOCX are generated rather than "download the HTML and rename it",
 * because a .pptx that PowerPoint refuses to open is worse than no export at
 * all. The deck's stored structure is what makes this cheap: slides are data,
 * so each target reads the same shape.
 *
 * PDF is deliberately absent. Producing one server-side needs a headless
 * browser — a large dependency and a second sandbox to worry about — and the
 * exported HTML already carries print styles, so the browser's own "Save as
 * PDF" gets there. Claiming a PDF export that shells out to Chrome would cost
 * more than it is worth here.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { errors } from '@reklu/shared';
import { renderDeckHtml, type Deck, type Slide } from './deck';

export type ExportFormat = 'html' | 'md' | 'txt' | 'pptx' | 'docx';

export interface ExportedFile {
  readonly body: Buffer;
  readonly contentType: string;
  readonly extension: string;
}

/** Formats an artifact of this type can actually produce. */
export function availableFormats(artifactType: string): readonly ExportFormat[] {
  switch (artifactType) {
    case 'presentation':
      return ['pptx', 'html', 'txt'];
    case 'document':
    case 'research_report':
      return ['docx', 'md', 'txt'];
    default:
      return ['txt'];
  }
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** A deck as a real PowerPoint file. */
export async function deckToPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = deck.title;

  // Title slide, from the deck's own title rather than an invented one.
  const cover = pptx.addSlide();
  cover.addText(deck.title, {
    x: 0.6, y: 2.2, w: 8.8, h: 1.2,
    fontSize: 40, bold: true, color: '111111',
  });
  if (deck.subtitle) {
    cover.addText(deck.subtitle, {
      x: 0.6, y: 3.4, w: 8.8, h: 0.8, fontSize: 18, color: '666666',
    });
  }

  for (const slide of deck.slides) {
    const target = pptx.addSlide();

    target.addText(slide.title, {
      x: 0.6, y: 0.5, w: 8.8, h: 0.9,
      fontSize: slide.layout === 'title' ? 32 : 26,
      bold: true,
      color: '111111',
    });

    if (slide.bullets.length > 0) {
      target.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.6, w: 8.4, h: 3.6, fontSize: 16, color: '333333', lineSpacingMultiple: 1.3 },
      );
    }

    // Presenter notes belong in the notes pane, not on the slide.
    if (slide.notes) target.addNotes(slide.notes);
  }

  // `write` returns a Buffer under Node when asked for one.
  const output = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return output;
}

/**
 * Markdown as a Word document.
 *
 * A deliberately small subset — headings, bullets, paragraphs — because a full
 * Markdown-to-OOXML conversion is its own project, and silently dropping
 * formatting the user can see in the preview would be worse than converting
 * the structure that carries the meaning.
 */
export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const children: Paragraph[] = [];

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.trim() === '') continue;

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      children.push(
        new Paragraph({
          text: heading[2]!.trim(),
          heading:
            level === 1
              ? HeadingLevel.HEADING_1
              : level === 2
                ? HeadingLevel.HEADING_2
                : level === 3
                  ? HeadingLevel.HEADING_3
                  : HeadingLevel.HEADING_4,
        }),
      );
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      children.push(new Paragraph({ text: bullet[1]!.trim(), bullet: { level: 0 } }));
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      children.push(new Paragraph({ text: numbered[1]!.trim(), bullet: { level: 0 } }));
      continue;
    }

    // Inline emphasis markers would otherwise appear literally in Word.
    children.push(
      new Paragraph({
        children: [new TextRun(line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1'))],
      }),
    );
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  }

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export interface ExportInput {
  readonly artifactType: string;
  readonly format: ExportFormat;
  readonly title: string;
  readonly contentText: string | null;
  /** Structured content — the deck lives here for presentations. */
  readonly content: unknown;
}

export async function exportArtifact(input: ExportInput): Promise<ExportedFile> {
  if (!availableFormats(input.artifactType).includes(input.format)) {
    throw errors.validation(
      `A ${input.artifactType.replace(/_/g, ' ')} cannot be exported as ${input.format}.`,
    );
  }

  const deck = (input.content as { deck?: Deck } | null)?.deck;
  const text = input.contentText ?? '';

  switch (input.format) {
    case 'pptx': {
      if (!deck) throw errors.validation('This presentation has no slide data to export.');
      return { body: await deckToPptx(deck), contentType: CONTENT_TYPES.pptx, extension: 'pptx' };
    }

    case 'docx':
      return {
        body: await markdownToDocx(text, input.title),
        contentType: CONTENT_TYPES.docx,
        extension: 'docx',
      };

    case 'html': {
      if (!deck) throw errors.validation('This artifact has no deck to render.');
      return {
        body: Buffer.from(renderDeckHtml(deck), 'utf8'),
        contentType: CONTENT_TYPES.html,
        extension: 'html',
      };
    }

    case 'md':
      return { body: Buffer.from(text, 'utf8'), contentType: CONTENT_TYPES.md, extension: 'md' };

    case 'txt':
      return { body: Buffer.from(text, 'utf8'), contentType: CONTENT_TYPES.txt, extension: 'txt' };
  }
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * The title is model- or user-supplied, so quotes, newlines and path
 * separators are all reachable — and a newline here is header injection.
 */
export function exportFilename(title: string, extension: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);

  return `${base || 'reklu-export'}.${extension}`;
}

export type { Deck, Slide };
