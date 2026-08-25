/**
 * The pictures on a generated site.
 *
 * A model asked for a barber shop landing page will write `<img src="...">`
 * pointing at whatever URL it can recall, and what came back was a photograph of
 * someone deadlifting. It was not a bad guess so much as a guess: no model has a
 * catalogue of real image URLs to draw on, so anything it writes there is either
 * remembered wrong or invented, and an invented URL is a broken image.
 *
 * So the model does not choose pictures. It says what each picture must show,
 * in the `alt` text it has to write anyway, and Reklu generates it. The
 * accessibility rule and the art direction turn out to be the same sentence.
 */
import { storage } from '@reklu/storage';
import { errors, logger } from '@reklu/shared';
import type { GeneratedFile } from './parse';

/** Where a generated picture is referenced from, and what it must show. */
export interface ArtworkRequest {
  /** The path in the app: `public/generated/hero.png`. */
  readonly path: string;
  /** The `alt` text, which is the art direction. */
  readonly description: string;
  /** Wider than tall for a hero, square for a portrait or a tile. */
  readonly shape: 'landscape' | 'square' | 'portrait';
}

/** The prefix the model is told to use. Everything under it is Reklu's to fill. */
const PREFIX = '/generated/';

/**
 * Find every picture the application expects to exist.
 *
 * Matched on the `src` and read back to the `alt` of the same tag, across line
 * breaks — a formatted JSX image element puts them on separate lines, and a
 * pattern that only looked at one line found nothing on real output.
 */
export function plannedArtwork(files: readonly GeneratedFile[]): readonly ArtworkRequest[] {
  const found = new Map<string, ArtworkRequest>();

  for (const file of files) {
    if (file.binary) continue;

    /* The whole element, so `alt` can be read whether it precedes or follows `src`. */
    const elements = file.content.matchAll(/<(?:img|Image)\b[^>]*>/gs);

    for (const [element] of elements) {
      const source = /src=(?:"([^"]*)"|\{?['"]([^'"]*)['"]\}?)/.exec(element);
      const reference = source?.[1] ?? source?.[2];
      if (!reference?.startsWith(PREFIX)) continue;

      const alt = /alt=(?:"([^"]*)"|\{?['"]([^'"]*)['"]\}?)/.exec(element);
      const description = (alt?.[1] ?? alt?.[2] ?? '').trim();

      /*
       * No description, no picture. Generating something arbitrary would put a
       * confidently wrong image on the page — which is the failure this exists
       * to remove, not a smaller version of it.
       */
      if (description.length < 8) continue;

      const path = `public${reference}`;
      if (found.has(path)) continue;

      found.set(path, { path, description, shape: shapeFor(element, reference) });
    }
  }

  return [...found.values()];
}

/**
 * How the picture should be proportioned.
 *
 * Taken from the width and height the site already declares, because a marketing
 * site states them to stop the page shifting as it loads. Where it says nothing,
 * a hero is wide and everything else is square.
 */
function shapeFor(element: string, reference: string): ArtworkRequest['shape'] {
  const width = Number(/width=\{?["']?(\d+)/.exec(element)?.[1] ?? 0);
  const height = Number(/height=\{?["']?(\d+)/.exec(element)?.[1] ?? 0);

  if (width && height) {
    if (width > height * 1.2) return 'landscape';
    if (height > width * 1.2) return 'portrait';
    return 'square';
  }

  return /hero|banner|cover|header/i.test(reference) ? 'landscape' : 'square';
}

/** What to ask an image model for, given what the page says the picture shows. */
export function artworkPrompt(request: ArtworkRequest, subject: string): string {
  return [
    `A high-quality photograph for the website of ${subject}.`,
    '',
    `The picture must show: ${request.description}`,
    '',
    'Realistic, professionally lit, shot on a full-frame camera with shallow depth',
    'of field. Natural colour. No text, no watermark, no logo, no lettering of any',
    'kind anywhere in the frame — this sits behind real headings on a real page.',
  ].join('\n');
}

export interface ArtworkResult {
  readonly files: readonly GeneratedFile[];
  readonly generated: number;
  /** Said out loud rather than swallowed: a picture that failed left a gap. */
  readonly failures: readonly { path: string; reason: string }[];
}

/**
 * Draw everything the application asked for.
 *
 * One at a time, and never in parallel: image generation is the most expensive
 * call in a build, and a page wanting six of them must not open six connections
 * to a provider that rate-limits by the minute.
 */
export async function drawArtwork(
  files: readonly GeneratedFile[],
  subject: string,
  draw: (prompt: string, shape: ArtworkRequest['shape']) => Promise<GeneratedFile['binary']>,
  onProgress?: (message: string) => Promise<void> | void,
): Promise<ArtworkResult> {
  const requests = plannedArtwork(files);
  if (requests.length === 0) return { files, generated: 0, failures: [] };

  const drawn = new Map<string, NonNullable<GeneratedFile['binary']>>();
  const failures: { path: string; reason: string }[] = [];

  for (const [index, request] of requests.entries()) {
    await onProgress?.(
      `Drawing image ${index + 1} of ${requests.length}: ${request.description.slice(0, 60)}`,
    );

    try {
      const binary = await draw(artworkPrompt(request, subject), request.shape);
      if (binary) drawn.set(request.path, binary);
    } catch (error) {
      /*
       * One picture failing must not lose the build. The application is written
       * and working; what is missing is a photograph, and saying so is better
       * than throwing away everything around it.
       */
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('An image could not be generated', { path: request.path, reason });
      failures.push({ path: request.path, reason });
    }
  }

  const additions: GeneratedFile[] = [...drawn.entries()].map(([path, binary]) => ({
    path,
    content: '',
    language: 'image',
    binary,
  }));

  const replaced = new Set(additions.map((file) => file.path));

  return {
    files: [...files.filter((file) => !replaced.has(file.path)), ...additions],
    generated: additions.length,
    failures,
  };
}

/** Never reached in normal use; keeps the module honest about its own contract. */
export function assertDrawable(subject: string): void {
  if (!subject.trim()) throw errors.validation('An image needs a subject to be about.');
}

/**
 * Turn a tree into files a sandbox can be given.
 *
 * The pictures are fetched here and nowhere else. They are the only files whose
 * bytes are not already in hand, and this is the last moment before they are
 * needed — everything upstream carries a key precisely so that reading a build
 * does not mean reading its photographs.
 */
export async function withImageBytes(
  files: readonly GeneratedFile[],
): Promise<{ path: string; content: string; encoding?: 'utf8' | 'base64' }[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!file.binary) return { path: file.path, content: file.content };

      try {
        const object = await storage().get(file.binary.storageKey);
        return {
          path: file.path,
          content: object.body.toString('base64'),
          encoding: 'base64' as const,
        };
      } catch (error) {
        /*
         * A picture that cannot be fetched must not stop the site from running.
         * The page renders with one broken image, which is visible and fixable;
         * a preview that refuses to start over a missing photograph is neither.
         */
        logger.warn('A generated image could not be read back', {
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
        return { path: file.path, content: '' };
      }
    }),
  );
}
