/**
 * Generating documents, decks and images (spec §42–§44).
 *
 * Everything Create produces becomes an **artifact**, so it inherits version
 * history, restore, and the artifacts library for free. Create is a set of
 * shaped prompts and a parser; it is not a second content system.
 */
import {
  autoRoutableModels,
  checkQuota,
  getProvider,
  loadRegistry,
  recordUsage,
  selectableModels,
  type RegisteredModel,
} from '@reklu/ai';
import { createArtifact } from '@reklu/artifacts';
import { errors, logger } from '@reklu/shared';
import { deckToText, parseDeck, renderDeckHtml, type Deck } from './deck';
import { generateImage, imageAvailability } from './images';

export type CreateKind = 'document' | 'presentation' | 'image' | 'video';

export interface CreateInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId?: string | null;
  readonly prompt: string;
  readonly modelKey?: string | undefined;
}

export interface CreateResult {
  readonly artifactId: string;
  readonly title: string;
  readonly kind: CreateKind;
  readonly detail: string;
  /**
   * Where the produced file lives, when the result is one.
   *
   * Set for images so a caller can show the picture rather than describe it.
   */
  readonly storageKey?: string;
  readonly size?: string;
  readonly bytes?: number;
}

/**
 * Refuse before spending, not after.
 *
 * Create was shipped without this: documents, decks and images all called a
 * provider with no quota check at all. Image generation is the most expensive
 * single operation in the product, so it was also the most expensive thing to
 * leave unmetered.
 */
async function assertWithinQuota(workspaceId: string): Promise<Date> {
  const quota = await checkQuota(workspaceId);

  if (quota?.exceeded) {
    throw errors.quotaExceeded({
      resource: 'AI units',
      used: Math.round(quota.used),
      limit: quota.limit ?? 0,
      resetsAt: quota.periodEnd,
    });
  }

  // The period the resulting usage row counts against.
  return quota?.periodStart ?? new Date();
}

async function pickModel(preferred?: string): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  const allowed = selectableModels(registry, undefined);

  if (allowed.length === 0) {
    throw errors.notConfigured({
      feature: 'Create',
      requiredEnv: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
      docsPath: '/settings',
    });
  }

  const explicitlySelected = preferred
    ? allowed.find((model) => model.key === preferred)
    : undefined;
  if (explicitlySelected) return explicitlySelected;

  const automatic = autoRoutableModels(allowed);
  const selected =
    automatic.find((model) => model.bestFor.includes('writing')) ??
    automatic.find((model) => model.bestFor.includes('reasoning')) ??
    automatic[0];
  if (!selected) {
    throw errors.notConfigured({
      feature: 'Create automatic routing',
      requiredEnv: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
      docsPath: '/settings',
    });
  }
  return selected;
}

const DOCUMENT_PROMPT = `You write clear, well-structured documents.

Return Markdown only — no preamble, no explanation of what you produced.
Open with a single H1 title. Use H2 sections. Prefer short paragraphs over
long ones, and use lists only where the content is genuinely a list.

Write the document the request asks for. Do not describe how you would write
it, and do not add commentary about your own output.`;

const DECK_PROMPT = `You design presentation decks.

Return ONE JSON object and nothing else:

{
  "title": "Deck title",
  "subtitle": "Optional one line",
  "slides": [
    { "layout": "title", "title": "Opening", "notes": "what to say" },
    { "layout": "bullets", "title": "Section", "bullets": ["point", "point"], "notes": "..." }
  ]
}

Layouts: title, bullets, quote, statement, two-column.
Six to twelve slides unless asked otherwise. At most six bullets per slide, and
keep each bullet to one line — a slide is not a document. Put the sentences a
presenter would say into "notes".`;

/** Generate a Markdown document and save it as an artifact. */
export async function createDocument(input: CreateInput): Promise<CreateResult> {
  const periodStart = await assertWithinQuota(input.workspaceId);
  const model = await pickModel(input.modelKey);
  const provider = getProvider(model.providerKey);
  if (!provider) throw errors.providerUnavailable(model.providerKey, model.key);

  const result = await provider.generate({
    modelIdentifier: model.modelIdentifier,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
    system: DOCUMENT_PROMPT,
    maxOutputTokens: 6_000,
  });

  await recordUsage({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    model,
    usage: result.usage,
    kind: 'chat',
    operation: 'Document',
    autoRouted: !input.modelKey,
    periodStart,
  });

  const markdown = result.text.trim();
  if (markdown.length < 40) {
    // Better to say the model produced nothing usable than to save an empty
    // document the user has to open to discover is empty.
    throw errors.internal('The model returned no usable document.');
  }

  // The first H1 is the document's own title; falling back to the prompt keeps
  // the library readable when the model omits one.
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  const title = heading || input.prompt.slice(0, 60);

  const { artifact } = await createArtifact({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    type: 'document',
    title,
    content: { format: 'markdown', markdown },
    contentText: markdown,
    modelKey: model.key,
  });

  logger.info('Created a document', { artifactId: artifact.id, chars: markdown.length });

  return {
    artifactId: artifact.id,
    title,
    kind: 'document',
    detail: `${markdown.split(/\s+/).length} words`,
  };
}

/** Generate a deck and save both its structure and a rendered HTML version. */
export async function createPresentation(input: CreateInput): Promise<CreateResult> {
  const periodStart = await assertWithinQuota(input.workspaceId);
  const model = await pickModel(input.modelKey);
  const provider = getProvider(model.providerKey);
  if (!provider) throw errors.providerUnavailable(model.providerKey, model.key);

  const result = await provider.generate({
    modelIdentifier: model.modelIdentifier,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
    system: DECK_PROMPT,
    maxOutputTokens: 6_000,
    temperature: 0.4,
  });

  await recordUsage({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    model,
    usage: result.usage,
    kind: 'chat',
    operation: 'Presentation',
    autoRouted: !input.modelKey,
    periodStart,
  });

  const deck: Deck | undefined = parseDeck(result.text, input.prompt.slice(0, 60));
  if (!deck) {
    throw errors.internal('The model did not return a deck that could be read.');
  }

  const { artifact } = await createArtifact({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    type: 'presentation',
    title: deck.title,
    // Structure is the source of truth; the HTML is a rendering of it, so a
    // future editor can change one slide without reparsing a document.
    content: { format: 'deck', deck, html: renderDeckHtml(deck) },
    contentText: deckToText(deck),
    modelKey: model.key,
  });

  return {
    artifactId: artifact.id,
    title: deck.title,
    kind: 'presentation',
    detail: `${deck.slides.length} slides`,
  };
}

/** Generate an image and save it as an artifact pointing at the stored object. */
export async function createImage(
  input: CreateInput & { size?: '1024x1024' | '1536x1024' | '1024x1536' },
): Promise<CreateResult> {
  await assertWithinQuota(input.workspaceId);

  const image = await generateImage({
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    size: input.size,
  });

  const title = input.prompt.slice(0, 60);

  const { artifact } = await createArtifact({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    type: 'image',
    title,
    storageKey: image.storageKey,
    // The prompt is the only searchable text an image has.
    contentText: input.prompt,
    metadata: {
      size: image.size,
      bytes: image.bytes,
      ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
    },
  });

  return {
    artifactId: artifact.id,
    title,
    kind: 'image',
    detail: `${image.size} · ${Math.round(image.bytes / 1024)} KB`,
    storageKey: image.storageKey,
    size: image.size,
    bytes: image.bytes,
  };
}

export interface CreateAvailability {
  readonly kind: CreateKind;
  readonly available: boolean;
  readonly detail: string;
}

/**
 * What this deployment can actually produce.
 *
 * Video is declared and unimplemented; it reports that plainly rather than
 * offering a button that fails (spec §25).
 */
export async function createAvailability(): Promise<CreateAvailability[]> {
  const registry = await loadRegistry();
  const hasModel = selectableModels(registry, undefined).length > 0;
  const modelDetail = hasModel
    ? 'Ready.'
    : 'No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.';

  const image = imageAvailability();

  return [
    { kind: 'document', available: hasModel, detail: modelDetail },
    { kind: 'presentation', available: hasModel, detail: modelDetail },
    { kind: 'image', available: image.available, detail: image.detail },
    {
      kind: 'video',
      available: false,
      detail:
        'Video generation is not implemented. No VIDEO_PROVIDER is supported yet, ' +
        'so this would fail rather than produce anything.',
    },
  ];
}
