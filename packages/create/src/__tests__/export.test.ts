import { describe, expect, it } from 'vitest';
import { availableFormats, deckToPptx, exportArtifact, exportFilename, markdownToDocx } from '../export';
import { parseDeck } from '../deck';

const deck = parseDeck(
  JSON.stringify({
    title: 'Quarterly Review',
    subtitle: 'Q3',
    slides: [
      { layout: 'title', title: 'Q3 Review', notes: 'welcome them' },
      { layout: 'bullets', title: 'Highlights', bullets: ['Revenue up', 'Churn down'] },
    ],
  }),
  'Fallback',
)!;

/** OOXML files are ZIP archives; every real one starts with "PK". */
const isZip = (buffer: Buffer): boolean =>
  buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

describe('availableFormats', () => {
  it('offers PowerPoint for presentations', () => {
    expect(availableFormats('presentation')).toContain('pptx');
  });

  it('offers Word for documents', () => {
    expect(availableFormats('document')).toContain('docx');
  });

  // Offering a format that cannot be produced is worse than not offering it.
  it('does not offer pptx for a document', () => {
    expect(availableFormats('document')).not.toContain('pptx');
  });

  it('falls back to plain text for anything else', () => {
    expect(availableFormats('image')).toEqual(['txt']);
  });
});

describe('deckToPptx', () => {
  it('produces a real OOXML package, not renamed HTML', async () => {
    const buffer = await deckToPptx(deck);
    expect(isZip(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(5_000);
  });

  it('survives a deck with no bullets anywhere', async () => {
    const bare = parseDeck(JSON.stringify({ slides: [{ title: 'Only a title' }] }), 'D')!;
    expect(isZip(await deckToPptx(bare))).toBe(true);
  });

  // Model output reaches the file; characters that break XML must not.
  it('handles characters that would break XML', async () => {
    const hostile = parseDeck(
      JSON.stringify({
        title: 'A & B <tag> "quoted"',
        slides: [{ title: '<script>', bullets: ['1 < 2 & 3 > 2'] }],
      }),
      'D',
    )!;
    expect(isZip(await deckToPptx(hostile))).toBe(true);
  });
});

describe('markdownToDocx', () => {
  it('produces a real OOXML package', async () => {
    const buffer = await markdownToDocx('# Title\n\nSome prose.', 'T');
    expect(isZip(buffer)).toBe(true);
  });

  it('handles headings, bullets and numbered lists', async () => {
    const markdown = '# H1\n## H2\n- one\n- two\n1. first\n\nParagraph.';
    expect(isZip(await markdownToDocx(markdown, 'T'))).toBe(true);
  });

  // An empty document still has to be a valid file, not a corrupt one.
  it('produces a valid file from empty input', async () => {
    expect(isZip(await markdownToDocx('', 'Fallback Title'))).toBe(true);
  });
});

describe('exportArtifact', () => {
  it('exports a presentation as pptx', async () => {
    const file = await exportArtifact({
      artifactType: 'presentation',
      format: 'pptx',
      title: 'Review',
      contentText: 'outline',
      content: { deck },
    });
    expect(file.extension).toBe('pptx');
    expect(file.contentType).toContain('presentationml');
    expect(isZip(file.body)).toBe(true);
  });

  it('exports a document as docx', async () => {
    const file = await exportArtifact({
      artifactType: 'document',
      format: 'docx',
      title: 'Brief',
      contentText: '# Brief\n\nBody.',
      content: null,
    });
    expect(file.extension).toBe('docx');
    expect(isZip(file.body)).toBe(true);
  });

  it('refuses a format the artifact type cannot produce', async () => {
    await expect(
      exportArtifact({
        artifactType: 'document',
        format: 'pptx',
        title: 'X',
        contentText: 'x',
        content: null,
      }),
    ).rejects.toThrow(/cannot be exported/);
  });

  // A presentation whose deck data is missing must say so, not emit an empty file.
  it('refuses a presentation with no deck data', async () => {
    await expect(
      exportArtifact({
        artifactType: 'presentation',
        format: 'pptx',
        title: 'X',
        contentText: 'x',
        content: null,
      }),
    ).rejects.toThrow(/no slide data/);
  });
});

/**
 * The filename lands in a Content-Disposition header, and the title is model-
 * or user-supplied. A newline here is header injection.
 */
describe('exportFilename', () => {
  it('keeps an ordinary title readable', () => {
    expect(exportFilename('Quarterly Review', 'pptx')).toBe('Quarterly-Review.pptx');
  });

  it.each([
    ['newline', 'Title\nX-Injected: 1'],
    ['carriage return', 'Title\r\nX: 1'],
    ['quotes', 'A "quoted" title'],
    ['path separators', '../../etc/passwd'],
    ['semicolon', 'a; filename=evil'],
  ])('strips %s', (_label, title) => {
    const filename = exportFilename(title, 'txt');
    expect(filename).not.toMatch(/[\r\n"';]/);
    expect(filename).not.toContain('..');
    expect(filename).not.toContain('/');
  });

  it('falls back rather than producing a bare extension', () => {
    expect(exportFilename('!!!', 'pptx')).toBe('reklu-export.pptx');
    expect(exportFilename('', 'docx')).toBe('reklu-export.docx');
  });

  it('strips accents rather than turning them into separators', () => {
    expect(exportFilename('Résumé Final', 'docx')).toBe('Resume-Final.docx');
  });
});
