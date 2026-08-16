import 'server-only';
import type { ContentPart } from '@reklu/ai';
import type { FileRecord } from '@reklu/database';
import { storage } from '@reklu/storage';

/**
 * Turn stored files into model content parts.
 *
 * This is the untrusted-content boundary in practice
 * (docs/AI_ARCHITECTURE.md §7). File contents are attacker-controlled — anyone
 * can upload a document containing "ignore previous instructions" — so they
 * enter as **user-role data**, fenced and labelled with their filename, and
 * never as system instruction.
 *
 * The fence is explicit rather than decorative: the model is told this is
 * document content supplied by the user, so instructions found inside it are
 * material to read about, not commands to follow.
 */

/** Guards a single file from consuming the whole context window. */
const MAX_CHARS_PER_FILE = 60_000;

function fence(filename: string, body: string): string {
  return [
    `<document filename="${filename.replace(/"/g, "'")}">`,
    body,
    '</document>',
  ].join('\n');
}

export async function buildAttachmentParts(
  attachments: readonly FileRecord[],
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  for (const file of attachments) {
    const metadata = file.metadata as { category?: string } | null;

    // Images go to vision-capable models as image parts. Reklu Auto sees the
    // image part and filters to a model that can actually process it.
    if (metadata?.category === 'image') {
      try {
        const object = await storage().get(file.storageKey);
        parts.push({
          type: 'image',
          image: `data:${file.contentType};base64,${object.body.toString('base64')}`,
          mimeType: file.contentType,
        });
      } catch {
        parts.push({
          type: 'text',
          text: fence(file.filename, '[This image could not be read from storage.]'),
        });
      }
      continue;
    }

    if (file.extractedText && file.extractedText.trim().length > 0) {
      const body = file.extractedText.slice(0, MAX_CHARS_PER_FILE);
      const truncated = file.extractedText.length > MAX_CHARS_PER_FILE;
      parts.push({
        type: 'text',
        text: fence(file.filename, truncated ? `${body}\n\n[… truncated]` : body),
      });
      continue;
    }

    // Attached but unreadable. Say so in-context rather than silently omitting
    // it — otherwise the model answers as though the file were empty and the
    // user cannot tell why the answer ignores their document.
    parts.push({
      type: 'text',
      text: fence(
        file.filename,
        `[Reklu stored this ${file.contentType} file but could not extract its text. ` +
          `${file.statusDetail ?? ''} Ask the user about its contents rather than guessing.]`,
      ),
    });
  }

  return parts;
}

// Deliberately one function only. An earlier synchronous variant existed for
// text-only callers, but it silently dropped images — exactly the kind of
// near-identical pair that produces a bug nobody notices until a vision
// request quietly answers without ever seeing the picture.
