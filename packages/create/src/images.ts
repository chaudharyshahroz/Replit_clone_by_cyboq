/**
 * Image generation (spec §44).
 *
 * Generated images are stored like any other object — server-generated key,
 * time-limited signed URL — so an image's key never becomes its permission.
 * The provider returns base64 rather than a URL on purpose: a provider-hosted
 * URL expires, and an artifact that silently turns into a broken image later
 * is worse than one that took an extra second to save.
 */
import { loadServerEnv } from '@reklu/shared';
import { errors, logger, newId } from '@reklu/shared';
import { buildKey, storage } from '@reklu/storage';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
export type ImageQuality = 'low' | 'medium' | 'high';

export interface GenerateImageInput {
  readonly workspaceId: string;
  readonly prompt: string;
  readonly size?: ImageSize | undefined;
  readonly quality?: ImageQuality | undefined;
}

export interface GeneratedImage {
  readonly storageKey: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly size: ImageSize;
  /** What the provider actually used, which may differ from the request. */
  readonly revisedPrompt?: string | undefined;
}

const MAX_PROMPT_CHARS = 4_000;
const TIMEOUT_MS = 120_000;

/** Whether image generation can run at all, and why not when it cannot. */
export function imageAvailability(): { available: boolean; detail: string } {
  const env = loadServerEnv();

  /*
   * Pollinations needs no credential at all, which is the whole reason it is
   * here — with it, a generated site costs nothing to illustrate.
   */
  if (env.IMAGE_PROVIDER === 'pollinations') {
    return { available: true, detail: 'Images are generated free through Pollinations.' };
  }

  if (env.IMAGE_PROVIDER === 'openai') {
    return env.OPENAI_API_KEY
      ? { available: true, detail: 'OpenAI image generation is configured.' }
      : { available: false, detail: 'IMAGE_PROVIDER=openai requires OPENAI_API_KEY.' };
  }

  return env.GOOGLE_GENERATIVE_AI_API_KEY
    ? { available: true, detail: 'Google image generation is configured.' }
    : {
        available: false,
        detail: 'IMAGE_PROVIDER=google requires GOOGLE_GENERATIVE_AI_API_KEY.',
      };
}

export async function generateImage(input: GenerateImageInput): Promise<GeneratedImage> {
  const env = loadServerEnv();
  const availability = imageAvailability();

  if (!availability.available) {
    // Names the variable rather than reporting a generic failure (spec §25).
    throw errors.notConfigured({
      feature: 'Image generation',
      requiredEnv: env.IMAGE_PROVIDER === 'openai' ? ['OPENAI_API_KEY'] : ['GOOGLE_GENERATIVE_AI_API_KEY'],
      docsPath: '/settings',
    });
  }

  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw errors.validation('Describe the image you want in a few more words.');
  }

  const size = input.size ?? '1024x1024';

  if (env.IMAGE_PROVIDER === 'pollinations') {
    return generateWithPollinations({ ...input, prompt, size });
  }

  if (env.IMAGE_PROVIDER !== 'openai') {
    throw errors.notConfigured({
      feature: 'Google image generation',
      requiredEnv: ['IMAGE_PROVIDER=openai'],
      docsPath: '/settings',
    });
  }

  const started = Date.now();

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt.slice(0, MAX_PROMPT_CHARS),
      size,
      quality: input.quality ?? 'medium',
      n: 1,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Provider messages here are useful ("content policy") and carry no key.
    throw errors.validation(
      `The image could not be generated (HTTP ${response.status})${
        detail ? `: ${detail.slice(0, 300)}` : ''
      }`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const first = payload.data?.[0];

  if (!first?.b64_json) {
    throw errors.internal('The image provider returned no image data.');
  }

  const body = Buffer.from(first.b64_json, 'base64');
  // Server-generated key: the user never chooses where their object lands,
  // and the workspace id leads it so a bucket misconfiguration fails closed
  // per tenant.
  const key = buildKey({
    workspaceId: input.workspaceId,
    scope: 'media',
    fileId: newId('file'),
    suffix: 'generated.png',
  });

  await storage().put({
    key,
    body,
    contentType: 'image/png',
    filename: 'generated.png',
    metadata: { source: 'reklu-create' },
  });

  logger.info('Generated an image', {
    workspaceId: input.workspaceId,
    bytes: body.byteLength,
    durationMs: Date.now() - started,
  });

  return {
    storageKey: key,
    contentType: 'image/png',
    bytes: body.byteLength,
    size,
    revisedPrompt: first.revised_prompt,
  };
}

/**
 * Generate through Pollinations, which asks for no key.
 *
 * The free option, and it is worth being plain about the trade. It is slower
 * than a paid model, follows a prompt more loosely, and returns a smaller image
 * than it is asked for — the request below asks for 1536 wide and gets roughly
 * 940. For a photograph behind a heading that is enough, and it is the
 * difference between a site that costs a few cents to illustrate and one that
 * costs nothing.
 *
 * Pixabay is still tried first for anything a real photograph can answer. This
 * is the fallback for what a search cannot find.
 */
async function generateWithPollinations(input: {
  readonly workspaceId: string;
  readonly prompt: string;
  readonly size: ImageSize;
}): Promise<GeneratedImage> {
  const started = Date.now();
  const [width, height] = input.size.split('x').map(Number) as [number, number];

  const url = new URL(
    `https://image.pollinations.ai/prompt/${encodeURIComponent(input.prompt.slice(0, MAX_PROMPT_CHARS))}`,
  );
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  /* Without this the image comes back with a watermark burned into it. */
  url.searchParams.set('nologo', 'true');
  url.searchParams.set('model', 'flux');

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (!response.ok) {
    throw errors.validation(`The image could not be generated (HTTP ${response.status}).`);
  }

  const body = Buffer.from(await response.arrayBuffer());

  /*
   * Checked, because a free endpoint under load can answer 200 with an error
   * page. A few hundred bytes is not a photograph, and storing it would put a
   * broken image on the page instead of failing where the log can say so.
   */
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/') || body.byteLength < 2_000) {
    throw errors.validation('The image service answered with something that was not an image.');
  }

  const key = buildKey({
    workspaceId: input.workspaceId,
    scope: 'media',
    fileId: newId('file'),
    suffix: 'generated.jpg',
  });

  await storage().put({
    key,
    body,
    contentType,
    filename: 'generated.jpg',
    metadata: { source: 'pollinations' },
  });

  logger.info('Generated an image', {
    workspaceId: input.workspaceId,
    provider: 'pollinations',
    bytes: body.byteLength,
    durationMs: Date.now() - started,
  });

  return { storageKey: key, contentType, bytes: body.byteLength, size: input.size };
}
