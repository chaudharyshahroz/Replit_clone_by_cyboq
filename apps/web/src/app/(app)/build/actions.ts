'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { enqueue } from '@reklu/queue';
import {
  autoRoutableModels,
  checkQuota,
  loadRegistry,
  recordUsage,
  selectableModels,
  type RegisteredModel,
  type TokenUsage,
} from '@reklu/ai';
import {
  createCheckpoint,
  deployToVercel,
  describeSelection,
  exportToGitHub,
  fallbackBrief,
  generateBrief,
  chooseDirection,
  createDesignContract,
  auditDesignQuality,
  hydrationSafetyIssues,
  evaluateGenericity,
  describeDirection,
  describeEmptyGeneration,
  generateFiles,
  isVisualTarget,
  instrumentForVisualSelection,
  loadTree,
  mergeTree,
  resolveElement,
  startPreview,
  syncPreview,
  typecheckPreview,
  stopPreview,
  type GeneratedFile,
  type SourceMap,
  needsDesignPass,
  type BuildBrief,
  runDesignPass,
  previewLogs,
  activateCustomDomain,
  addMadeWithBadge,
  buildFailureDetail,
  currentPublication,
  dnsInstructions,
  describeInstallFailure,
  describeStartupFailure,
  drawArtwork,
  planFromResearch,
  planToPrompt,
  researchQuestion,
  type SitePlan,
  type ArtworkRequest,
  publicUrl,
  publishAvailability,
  publishSite,
  removeCustomDomain,
  setCustomDomain,
  unpublishSite,
  normalizeGeneratedTree,
  repairPreviewCompilation,
  previewEntryProblem,
  captureRenderedPreview,
  reviewRenderedDesign,
  visualRevisionPrompt,
  listCheckpoints,
  restoreCheckpoint,
  createDesignDNA,
  createDesignEngineV3,
  createDesignEngineV4,
  createDesignEngineV5,
  DESIGN_ENGINE_V4_REVISION,
  DesignEngineV4Schema,
  DesignEngineV5Schema,
  compileDesignTree,
  createInformationArchitecture,
  understandProduct,
  DesignDNASchema,
  DesignEngineV3Schema,
  type DesignDNA,
  type DesignEngineV3,
  chooseBuildPath,
  createBuildPerformanceTimeline,
  unresolvedLocalImports,
} from '@reklu/build';
import { buildEvents, buildProjects, db } from '@reklu/database';
import { listConnections } from '@reklu/integrations';
import { sandboxStatus } from '@reklu/sandbox';
import { errors, isRekluError, logger, newId, slugify, toRekluError } from '@reklu/shared';
import { findStockImage, generateImage } from '@reklu/create';
import { createWebAdapter, runResearch, SEARCH_PROVIDER_ENV } from '@reklu/research';
import { getAppContext } from '@/lib/auth-context';
import { loadAttachments } from '@/lib/files';
import { storage } from '@reklu/storage';

export interface BuildFormState {
  readonly error?: string;
}

/** Both first preview and edits to a running preview enter the same background pipeline. */
function scheduleDesignWork(buildId: string, workspaceId: string, userId: string) {
  after(async () => {
    try {
      const [current] = await db
        .select()
        .from(buildProjects)
        .where(and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspaceId)))
        .limit(1);
      if (!current?.currentVersionId) return;
      const analysis = (current.codebaseAnalysis ?? {}) as Record<string, unknown>;
      if (!DesignEngineV4Schema.safeParse(analysis.designEngineV4).success) return;
      const versionId = current.currentVersionId;
      const scope = and(
        eq(buildProjects.id, buildId),
        eq(buildProjects.workspaceId, workspaceId),
        eq(buildProjects.currentVersionId, versionId),
      );
      const claimed = await db
        .update(buildProjects)
        .set({
          codebaseAnalysis: sql`coalesce(${buildProjects.codebaseAnalysis}, '{}'::jsonb) || ${JSON.stringify({ designJobVersion: versionId })}::jsonb`,
        })
        .where(
          and(
            scope,
            sql`coalesce(${buildProjects.codebaseAnalysis}->>'designJobVersion', '') <> ${versionId}`,
          ),
        )
        .returning({ id: buildProjects.id });
      if (!claimed.length) return;
      try {
        await enqueue({
          kind: 'build_design',
          workspaceId,
          userId,
          resourceType: 'build',
          resourceId: buildId,
          payload: { buildProjectId: buildId, workspaceId, userId, versionId },
          jobOptions: { attempts: 1 },
        });
        await recordStep({
          buildId,
          workspaceId,
          kind: 'note',
          message: 'Design assets and rendered review queued. Preview remains interactive.',
        });
      } catch (error) {
        await db
          .update(buildProjects)
          .set({
            codebaseAnalysis: sql`(${buildProjects.codebaseAnalysis} - 'designJobVersion') || ${JSON.stringify({ designQuality: { status: 'pending', reason: 'Design queue unavailable; reopen preview to retry.' } })}::jsonb`,
          })
          .where(scope);
        throw error;
      }
    } catch (error) {
      logger.warn('Could not queue post-preview design work', {
        buildId,
        error,
      });
    }
  });
}

async function pickModel(
  requested?: string,
  excludeKeys: readonly string[] = [],
  needsVision = false,
): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  const excluded = new Set(excludeKeys);
  const allowed = selectableModels(registry, undefined).filter(
    (model) => !excluded.has(model.key) && (!needsVision || model.supportsVision),
  );
  if (allowed.length === 0) {
    throw errors.notConfigured({
      feature: needsVision ? 'Build image input' : 'Build',
      requiredEnv: needsVision
        ? [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'GOOGLE_GENERATIVE_AI_API_KEY',
            'OPENROUTER_API_KEY',
          ]
        : ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      docsPath: '/settings',
    });
  }
  /*
   * A chosen model is honoured, and an unavailable one falls back rather than
   * failing: the key names a model that may since have been disabled, and a
   * build is not the place to refuse work over a stale selection.
   */
  const explicitlySelected =
    requested && requested !== 'auto' ? allowed.find((model) => model.key === requested) : undefined;
  if (explicitlySelected) return explicitlySelected;

  const automatic = autoRoutableModels(allowed);
  const selected =
    automatic.find((model) => model.bestFor.includes('coding')) ??
    automatic.find((model) => model.bestFor.includes('reasoning')) ??
    automatic[0];
  if (!selected) {
    throw errors.notConfigured({
      feature: needsVision ? 'Build image input automatic routing' : 'Build automatic routing',
      requiredEnv: needsVision
        ? ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']
        : ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      docsPath: '/settings',
    });
  }
  return selected;
}

/**
 * The builder and design director have different jobs. Prefer a model that can
 * both reason about composition and safely rewrite React/CSS, while retaining
 * the selected build model as a guaranteed fallback for small/free registries.
 */
async function pickDesignModel(fallback: RegisteredModel): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  // A design pass is part of the selected build, not permission to spend a
  // second vendor key. Keep every hidden phase on the provider the user chose.
  const allowed = selectableModels(registry, undefined).filter(
    (model) => model.providerKey === fallback.providerKey,
  );
  const capable = allowed.filter(
    (model) => model.bestFor.includes('coding') || model.bestFor.includes('reasoning'),
  );

  return (
    [...capable].sort((left, right) => {
      const score = (model: RegisteredModel) =>
        (model.bestFor.includes('coding') ? 8 : 0) +
        (model.supportsVision ? 4 : 0) +
        (model.supportsReasoning ? 3 : 0) +
        Math.min(model.maxOutputTokens / 8_000, 2);
      return score(right) - score(left) || left.sortOrder - right.sortOrder;
    })[0] ?? fallback
  );
}

/** A compact reasoning/research model plans the site while the coding model stays focused on code. */
async function pickStrategyModel(fallback: RegisteredModel): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  const allowed = selectableModels(registry, undefined).filter(
    (candidate) =>
      candidate.inputCostPerMillion === 0 &&
      candidate.outputCostPerMillion === 0 &&
      (candidate.bestFor.includes('research') || candidate.bestFor.includes('reasoning')),
  );

  return (
    [...allowed].sort((left, right) => {
      const score = (candidate: RegisteredModel) =>
        (candidate.bestFor.includes('research') ? 8 : 0) +
        (candidate.bestFor.includes('reasoning') ? 5 : 0) +
        Math.min(candidate.contextWindow / 64_000, 2);
      return score(right) - score(left) || left.sortOrder - right.sortOrder;
    })[0] ?? fallback
  );
}

async function pickVisionModel(): Promise<RegisteredModel | undefined> {
  const registry = await loadRegistry();
  return selectableModels(registry, undefined)
    .filter(
      (model) =>
        model.supportsVision && model.inputCostPerMillion === 0 && model.outputCostPerMillion === 0,
    )
    .sort((left, right) => {
      const score = (model: RegisteredModel) =>
        (model.bestFor.includes('vision') ? 8 : 0) +
        (model.bestFor.includes('reasoning') ? 4 : 0) +
        (model.bestFor.includes('coding') ? 2 : 0);
      return score(right) - score(left) || left.sortOrder - right.sortOrder;
    })[0];
}

/** What a person asked for, and everything they pointed at while asking. */
export interface BuildRequest {
  readonly instruction: string;
  /**
   * Whether a person typed this. The first generation is started by Reklu with
   * an instruction nobody wrote — "build it as described in the brief" — and
   * showing that back as though they had said it would be putting words in
   * their mouth.
   */
  readonly origin?: 'user' | 'auto';
  /** An element picked with the arrow, resolved here through the source map. */
  readonly selection?: { readonly elementId: string };
  /** An element circled with the pencil. */
  readonly annotation?: { readonly elementId: string };
  /** Text retyped in place, as exact replacements. */
  readonly textChanges?: readonly {
    readonly elementId: string;
    readonly text: string;
  }[];
  /** Files attached to the message, already uploaded. */
  readonly fileIds?: readonly string[];
  /** A model chosen in the composer; absent means Reklu picks. */
  readonly modelKey?: string;
  /**
   * True for the pass that fixes what the compiler found.
   *
   * The guard against a loop. A repair is itself a generation, and a generation
   * typechecks — so without this, code the model cannot fix would be sent back
   * to it for as long as anybody was willing to pay for it.
   */
  readonly repairPass?: boolean;
}

/**
 * Start a build.
 *
 * Refuses when no sandbox is available rather than generating code that can
 * never run — a build project with no way to execute is a dead end the user
 * would only discover after waiting.
 */
export async function createBuildAction(
  _prev: BuildFormState,
  formData: FormData,
): Promise<BuildFormState> {
  const { user, workspace } = await getAppContext();
  const prompt = String(formData.get('prompt') ?? '').trim();
  /*
   * The model chosen on the form, honoured here as well as at generation.
   *
   * The brief decides the target, the stack and the pages, and it was always
   * written by whichever model `pickModel` preferred — so choosing one and
   * watching a different vendor's key be spent on the first call was a real
   * observation, not a misreading.
   */
  const requestedModel = String(formData.get('modelKey') ?? '').trim() || undefined;

  if (prompt.length < 8) {
    return { error: 'Describe what you want built in a little more detail.' };
  }

  const status = sandboxStatus();
  if (!status.available) {
    return { error: status.detail };
  }

  let buildId: string;

  try {
    const model = await pickModel(requestedModel);
    const quota = await checkQuota(workspace.workspaceId);
    if (quota?.exceeded) return { error: 'This workspace has used its AI credits for this period.' };
    const { brief, usedFallback, usage } = await generateBrief({ prompt, model });

    buildId = newId('build');
    await db.insert(buildProjects).values({
      id: buildId,
      workspaceId: workspace.workspaceId,
      createdById: user.id,
      name: brief.product.slice(0, 120),
      slug: `${slugify(brief.product)}-${buildId.slice(-6)}`,
      target: brief.target,
      status: 'briefing',
      brief: brief as unknown as Record<string, unknown>,
      framework: brief.stack[0] ?? null,
      createdBy: user.id,
    });

    await recordUsage({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      projectId: buildId,
      model,
      usage,
      kind: 'build',
      operation: 'Build brief',
      autoRouted: !requestedModel || requestedModel === 'auto',
      routingReason: requestedModel ? 'User-selected build provider' : 'Reklu Auto build routing',
      periodStart:
        quota?.periodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    });

    if (usedFallback) {
      logger.warn('Build brief fell back to heuristics', { buildId });
    }
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    logger.error('Build creation failed', { error });
    return { error: 'Could not start the build. Please try again.' };
  }

  redirect(`/build/${buildId}`);
}

/** Generate or revise the file tree, then checkpoint it. */
/** Build stages, in the words a reader would use. */
const STAGE_LABELS: Record<string, string> = {
  interpreting_product: 'Working out what to build',
  planning_architecture: 'Planning the architecture',
  generating_files: 'Writing the code',
  designing: 'Designing the interface',
  installing_dependencies: 'Installing dependencies',
  running_checks: 'Checking it builds',
  starting_preview: 'Starting the preview',
};

export interface BuildStep {
  readonly id: string;
  readonly kind: string;
  readonly message: string;
  readonly path: string | null;
}

export interface BuildProgress {
  readonly status: string;
  readonly detail: string | null;
  readonly fileCount: number;
  readonly steps: readonly BuildStep[];
}

/** Record one step, as it happens. Never fails the build it is describing. */
async function recordStep(params: {
  buildId: string;
  workspaceId: string;
  kind: string;
  message: string;
  path?: string;
}): Promise<void> {
  try {
    await db.insert(buildEvents).values({
      buildProjectId: params.buildId,
      workspaceId: params.workspaceId,
      kind: params.kind,
      message: params.message,
      path: params.path ?? null,
    });
  } catch (error) {
    logger.debug('Could not record a build step', {
      buildId: params.buildId,
      error,
    });
  }
}

/** Continue the same elapsed timeline across the generate and preview actions. */
async function recordPersistentPerformance(
  buildId: string,
  workspaceId: string,
  milestone: string,
  detail?: string,
): Promise<void> {
  const [first] = await db
    .select({ createdAt: buildEvents.createdAt })
    .from(buildEvents)
    .where(and(eq(buildEvents.buildProjectId, buildId), eq(buildEvents.kind, 'performance')))
    .orderBy(asc(buildEvents.createdAt))
    .limit(1);
  const now = new Date();
  await recordStep({
    buildId,
    workspaceId,
    kind: 'performance',
    message: JSON.stringify({
      milestone,
      elapsedMs: Math.max(0, now.getTime() - (first?.createdAt.getTime() ?? now.getTime())),
      at: now.toISOString(),
      ...(detail ? { detail } : {}),
    }),
  });
}

/** What the build is doing right now, for a screen that is watching it. */
export async function buildProgressAction(buildId: string): Promise<BuildProgress> {
  const { workspace } = await getAppContext();

  const [project] = await db
    .select({
      status: buildProjects.status,
      statusDetail: buildProjects.statusDetail,
    })
    .from(buildProjects)
    .where(and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)))
    .limit(1);

  if (!project) throw errors.notFound('Build project', buildId);

  const [files, steps] = await Promise.all([
    loadTree(buildId, workspace.workspaceId),
    db
      .select({
        id: buildEvents.id,
        kind: buildEvents.kind,
        message: buildEvents.message,
        path: buildEvents.path,
      })
      .from(buildEvents)
      .where(eq(buildEvents.buildProjectId, buildId))
      .orderBy(buildEvents.createdAt)
      .limit(200),
  ]);

  return {
    status: project.status,
    detail: project.statusDetail,
    fileCount: files.length,
    steps,
  };
}

export interface GenerateResult {
  readonly ok: boolean;
  readonly message: string;
  readonly fileCount: number;
}

/**
 * Generate or revise the application.
 *
 * Returns what happened rather than nothing. This used to return `void` and
 * never revalidate, so a click produced no files, no error and no change on
 * screen whether it succeeded or failed — the button appeared to do nothing
 * because, from the page's point of view, nothing did happen. A provider
 * refusing the request and a model returning an empty response were equally
 * silent.
 */
export async function generateBuildAction(
  buildId: string,
  request: BuildRequest,
): Promise<GenerateResult> {
  try {
    return await runGeneration(buildId, request);
  } catch (error) {
    const normalized = toRekluError(error);
    const message = normalized.userMessage;

    logger.error('Build generation failed', {
      buildId,
      error: normalized.message,
      code: normalized.code,
      retryable: normalized.retryable,
    });

    const context = await getAppContext().catch(() => undefined);
    if (context) {
      await recordStep({
        buildId,
        workspaceId: context.workspace.workspaceId,
        kind: 'say',
        message,
      }).catch(() => undefined);
    }

    await db
      .update(buildProjects)
      .set({ status: 'failed', statusDetail: message.slice(0, 500) })
      .where(eq(buildProjects.id, buildId));

    revalidatePath(`/build/${buildId}`);
    const fileCount = context
      ? await loadTree(buildId, context.workspace.workspaceId)
          .then((files) => files.length)
          .catch(() => 0)
      : 0;
    return { ok: false, message, fileCount };
  }
}

/**
 * Turn what a person did into what the model reads.
 *
 * Three things arrive separately and have to become one request: a sentence, an
 * element they pointed at, and files they attached. The element is the reason
 * this exists — "make this bigger" is not a request until "this" has a file and
 * a line number, and resolving it here rather than in the browser means the id
 * is checked against our own source map before it can steer an edit.
 */
async function composePrompt(
  request: BuildRequest,
  project: { readonly codebaseAnalysis: unknown },
  existing: readonly GeneratedFile[],
  workspaceId: string,
  userId: string,
): Promise<{ prompt: string; images: { image: string; mimeType: string }[] }> {
  const sections: string[] = [];
  const images: { image: string; mimeType: string }[] = [];

  const analysis = (project.codebaseAnalysis ?? {}) as {
    sourceMap?: SourceMap;
  };
  const locate = (elementId: string) =>
    analysis.sourceMap ? resolveElement(analysis.sourceMap, elementId) : undefined;

  /*
   * An element that no longer resolves is dropped rather than refused. The files
   * have been rewritten since it was picked, and the sentence typed against it
   * is usually still a perfectly good instruction on its own.
   */
  if (request.selection) {
    const location = locate(request.selection.elementId);
    if (location) sections.push(describeSelection(location, existing));
  }

  if (request.annotation) {
    const location = locate(request.annotation.elementId);
    if (location) {
      sections.push(
        [
          'The user drew a circle over the preview to mark what they mean.',
          'It encloses this element:',
          '',
          describeSelection(location, existing),
        ].join('\n'),
      );
    }
  }

  /*
   * Retyped text is given as exact replacements rather than as a description of
   * them. The person already wrote what they wanted, in the place they wanted
   * it; asking the model to infer the wording from a sentence about the wording
   * is how "change the heading" comes back as a different heading.
   */
  if (request.textChanges?.length) {
    const described = request.textChanges
      .map((change) => {
        const location = locate(change.elementId);
        if (!location) return null;
        return `- ${location.file}:${location.line} (<${location.tag}>) → ${JSON.stringify(
          change.text,
        )}`;
      })
      .filter((line): line is string => line !== null);

    if (described.length > 0) {
      sections.push(
        [
          'The user edited text directly in the preview. Set each element’s text to',
          'exactly the string given — do not rewrite, expand or correct it, and change',
          'nothing else in these files.',
          '',
          ...described,
        ].join('\n'),
      );
    }
  }

  if (request.fileIds?.length) {
    const attachments = await loadAttachments(workspaceId, request.fileIds);
    for (const record of attachments) {
      if (record.contentType.startsWith('image/')) {
        const object = await storage().get(record.storageKey);
        if (object) {
          images.push({
            image: `data:${record.contentType};base64,${object.body.toString('base64')}`,
            mimeType: record.contentType,
          });
          sections.push(`An image was attached: ${record.filename}. Build to match it.`);
        }
        continue;
      }
      if (record.extractedText) {
        sections.push(
          [
            `Attached file ${record.filename}:`,
            '```',
            record.extractedText.slice(0, 20_000),
            '```',
          ].join('\n'),
        );
        continue;
      }
      /*
       * Said rather than swallowed. A file that was attached and then silently
       * ignored is worse than one that was refused: the request goes out
       * missing the thing it was built around, and nothing says so.
       */
      sections.push(
        `A file was attached (${record.filename}, ${record.contentType}) but its contents could not be read.`,
      );
    }
  }

  sections.push(request.instruction);
  void userId;
  return { prompt: sections.join('\n\n'), images };
}

/**
 * Draw one picture for a build.
 *
 * A thin wrapper on the image generator that already exists, with the shape
 * mapped to a size the provider accepts. The bytes go to object storage and the
 * tree keeps only a key: a tree is read on every page load of the code view,
 * and a photograph is a megabyte.
 */
async function drawOne(
  request: ArtworkRequest,
  imagePrompt: string,
  workspaceId: string,
  /**
   * Which source answered, said out loud.
   *
   * Without it a search and a generation are indistinguishable from the log,
   * so there is no way to tell whether a Pixabay key is working — the build
   * simply costs less, or does not, and nothing says which.
   */
  report: (message: string) => Promise<void>,
): Promise<GeneratedFile['binary']> {
  const shape = request.shape;

  /*
   * A real photograph first, where one exists.
   *
   * Generating costs money and about half a minute, and a page wanting six
   * pictures costs six of each. For most of what a marketing site needs — a
   * barber at work, a coffee bar, a plate of food — a photograph of exactly
   * that already exists and is free. A miss costs one request and falls
   * through to the generator, which is the one that never misses.
   */
  const stock = await findStockImage({
    workspaceId,
    query: request.description,
    shape,
  });
  if (stock) {
    await report(`Found a photograph on Pixabay by ${stock.credit}`);
    return {
      storageKey: stock.storageKey,
      contentType: stock.contentType,
      bytes: stock.bytes,
    };
  }

  await report('No photograph matched; drawing one');

  const size =
    shape === 'landscape' ? '1536x1024' : shape === 'portrait' ? '1024x1536' : '1024x1024';

  const image = await generateImage({
    workspaceId,
    prompt: imagePrompt,
    size,
    /*
     * Medium, not high. These are photographs behind headings on a page that
     * has to load quickly, and the difference costs several times as much and
     * roughly a minute more per picture on a build that already takes minutes.
     */
    quality: 'medium',
  });

  return {
    storageKey: image.storageKey,
    contentType: image.contentType,
    bytes: image.bytes,
  };
}

async function runGeneration(buildId: string, request: BuildRequest): Promise<GenerateResult> {
  const { user, workspace } = await getAppContext();
  const quota = await checkQuota(workspace.workspaceId);
  if (quota?.exceeded) {
    return {
      ok: false,
      message: 'This workspace has used its AI credits for the current billing period.',
      fileCount: 0,
    };
  }
  const periodStart = quota?.periodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const meterBuildCall = async (
    selectedModel: RegisteredModel,
    usage: TokenUsage,
    operation: string,
    autoRouted = false,
  ) =>
    recordUsage({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      projectId: buildId,
      model: selectedModel,
      usage,
      kind: 'build',
      operation,
      autoRouted,
      routingReason: autoRouted ? 'Reklu Auto build routing' : 'User-selected build provider',
      periodStart,
    });
  const performance = createBuildPerformanceTimeline((mark) =>
    recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'performance',
      message: JSON.stringify(mark),
    }),
  );
  await performance.mark('prompt_received', request.origin ?? 'user');

  /*
   * What was asked, kept where the answer will appear — and it is the person's
   * own sentence, not the prompt assembled around it. A transcript that showed
   * the resolved source location and twelve lines of surrounding code back as
   * the user's message would be unreadable, and would not be true either.
   */
  if (request.origin !== 'auto') {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'ask',
      message: request.instruction.slice(0, 2_000),
    });
  }

  /*
   * Written before anything slow starts. The first model call takes a minute or
   * more, and until it reports a stage there is nothing for the screen to show
   * — which reads as a build that has not begun rather than one that has.
   */
  await recordStep({
    buildId,
    workspaceId: workspace.workspaceId,
    kind: 'stage',
    message: 'Reading the brief',
  });

  const [project] = await db
    .select()
    .from(buildProjects)
    .where(eq(buildProjects.id, buildId))
    .limit(1);

  if (!project || project.workspaceId !== workspace.workspaceId) {
    throw errors.notFound('Build project', buildId);
  }

  const needsVision = request.fileIds?.length
    ? (await loadAttachments(workspace.workspaceId, request.fileIds)).some((file) =>
        file.contentType.startsWith('image/'),
      )
    : false;
  let model = await pickModel(request.modelKey, [], needsVision);
  /*
   * Typed, not `never`. The cast used to erase the brief entirely, so the
   * target — which decides the stack, the standards and whether a design pass
   * runs — could not be read from it at all.
   */
  const brief = (project.brief as BuildBrief | null) ?? fallbackBrief(request.instruction);
  const existing = await loadTree(buildId, workspace.workspaceId);

  /*
   * Design DNA is a project property, not a per-call suggestion. Generate it
   * once, persist it in the existing project analysis envelope, and reuse it
   * for every later page and edit. This keeps the rollout backwards compatible
   * while a dedicated relational design-system model is introduced.
   */
  const storedAnalysis = (project.codebaseAnalysis ?? {}) as Record<string, unknown>;
  const storedDNA = DesignDNASchema.safeParse(storedAnalysis.designDNA);
  const storedEngineV3 = DesignEngineV3Schema.safeParse(storedAnalysis.designEngineV3);
  const storedEngineV4 = DesignEngineV4Schema.safeParse(storedAnalysis.designEngineV4);
  const storedEngineV5 = DesignEngineV5Schema.safeParse(storedAnalysis.designEngineV5);
  const productContext = understandProduct({
    product: brief.product,
    summary: brief.summary,
    target: brief.target,
    userRoles: brief.userRoles,
    pages: brief.pages,
  });
  // Compiler revisions are migrations, not optional styling. Refresh V4 projects so
  // repaired layout/media contracts are not stranded behind an older stored engine.
  // Legacy pre-V4 projects still are not silently restyled on a small edit.
  const shouldCreateV4 =
    isVisualTarget(brief.target) && (existing.length === 0 || storedEngineV4.success);
  const designEngineV4 = shouldCreateV4
    ? storedEngineV4.success && storedEngineV4.data.revision >= DESIGN_ENGINE_V4_REVISION
      ? storedEngineV4.data
      : createDesignEngineV4(productContext, buildId)
    : undefined;
  const designEngineV5 = designEngineV4
    ? storedEngineV5.success &&
      storedEngineV4.success &&
      storedEngineV4.data.revision >= DESIGN_ENGINE_V4_REVISION
      ? storedEngineV5.data
      : createDesignEngineV5(productContext, buildId)
    : undefined;
  const designEngineNeedsSave =
    Boolean(designEngineV4) &&
    (!storedEngineV4.success ||
      storedEngineV4.data.revision < DESIGN_ENGINE_V4_REVISION ||
      !storedEngineV5.success);
  const designDNA: DesignDNA =
    designEngineV4?.dna ?? (storedDNA.success ? storedDNA.data : createDesignDNA(productContext));
  const designEngineV3: DesignEngineV3 = storedEngineV3.success
    ? storedEngineV3.data
    : createDesignEngineV3(productContext);
  const informationArchitecture = createInformationArchitecture(productContext);
  const buildPath = chooseBuildPath(brief);
  await performance.mark('product_understood', productContext.productType);
  await performance.mark(
    'design_ready',
    designEngineV4?.selection.profile ?? designEngineV3.selected.conceptName,
  );

  await recordStep({
    buildId,
    workspaceId: workspace.workspaceId,
    kind: 'note',
    message: `${buildPath.path === 'fast' ? 'Fast Build' : 'Agentic Build'} path: ${buildPath.reason}`,
  });

  if (!storedDNA.success || !storedEngineV3.success || designEngineNeedsSave) {
    await db
      .update(buildProjects)
      .set({
        codebaseAnalysis: {
          ...storedAnalysis,
          productDesignContext: productContext,
          designDNA,
          designEngineV3,
          ...(designEngineV4 ? { designEngineV4 } : {}),
          ...(designEngineV5 ? { designEngineV5 } : {}),
          informationArchitecture,
        },
      })
      .where(eq(buildProjects.id, buildId));
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'stage',
      message: `Art direction ready: ${designEngineV3.selected.conceptName} — ${designEngineV3.selected.conceptStatement}`,
    });
  }

  const { prompt, images } = await composePrompt(
    request,
    project,
    existing,
    workspace.workspaceId,
    user.id,
  );

  /*
   * What comparable sites do, before deciding what this one should.
   *
   * Only on a first build. An edit already has a site with a shape; researching
   * the trade again would spend a minute and several searches to rediscover
   * decisions that are sitting in the files.
   */
  let plan: SitePlan | undefined;

  if (existing.length === 0 && buildPath.path === 'agentic') {
    const web = createWebAdapter();

    if (!web.isConfigured()) {
      /*
       * Said once, plainly, and then the build continues. A site nobody
       * researched is worth more than no site, and inventing competitors to
       * fill the gap would be worse than either.
       */
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'say',
        message:
          'Building without market research: no web search provider is configured. ' +
          `Set ${Object.values(SEARCH_PROVIDER_ENV).join(' or ')} to have Reklu study ` +
          'comparable sites first.',
      });
    } else {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message: 'Website Strategist: researching competitors and customer intent',
      });

      try {
        const strategyModel = await pickStrategyModel(model).catch(() => model);
        const outcome = await runResearch({
          query: researchQuestion(brief),
          mode: 'research',
          model: strategyModel,
          adapters: [web],
          /* Eight focused sources are enough to establish conventions without
           * turning every website build into a full deep-research session. */
          budget: { queries: 2, perQuery: 4, reportTokens: 1_800 },
          report: async (stage) => {
            await recordStep({
              buildId,
              workspaceId: workspace.workspaceId,
              kind: 'stage',
              message: stage.replace(/_/g, ' '),
            });
          },
        });

        /* The findings, with their real citations, shown to whoever asked. */
        if (outcome.report.trim()) {
          await recordStep({
            buildId,
            workspaceId: workspace.workspaceId,
            kind: 'say',
            message: outcome.report.slice(0, 8_000),
          });
        }

        plan = await planFromResearch({
          brief,
          report: outcome.report,
          model: strategyModel,
        });

        if (plan) {
          await recordStep({
            buildId,
            workspaceId: workspace.workspaceId,
            kind: 'stage',
            message: `Website Strategist planned ${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'} from ${outcome.sourcesUsed} source${outcome.sourcesUsed === 1 ? '' : 's'}`,
          });
        }
      } catch (error) {
        /*
         * Research is an improvement to a build, not a precondition for one.
         * A search provider that is down must not cost somebody their site.
         */
        logger.warn('Market research failed; building from the brief alone', {
          buildId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /*
   * What was chosen, before it is used. A generated site's palette and
   * typefaces are decisions somebody may want to argue with, and a decision
   * nobody can see is one nobody can argue with — so the direction goes in the
   * build log beside the stages, in the words the catalogue uses.
   */
  if (isVisualTarget(brief.target)) {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'note',
      message: `Design direction: ${designEngineV4?.dna.visualDirection ?? describeDirection(chooseDirection(brief))}.`,
    });
  }

  const generateWith = (selectedModel: RegisteredModel) =>
    generateFiles({
      brief,
      /* The plan leads, because it is the part derived from evidence. */
      prompt: plan ? `${planToPrompt(plan)}\n\n---\n\n${prompt}` : prompt,
      images,
      model: selectedModel,
      requireFiles: true,
      existingFiles: existing,
      designDNA,
      designEngineV3,
      designEngineV4,
      designEngineV5,
      /*
       * Each stage is written down as it is entered, in the words a reader would
       * use. The status alone said "generating" for the whole of a two-minute
       * call, so the screen had nothing to show between pressing the button and
       * the files appearing — which is indistinguishable from nothing happening.
       */
      report: async (stage) => {
        await db
          .update(buildProjects)
          .set({
            status: stage === 'generating_files' ? 'generating' : 'planning',
            statusDetail: STAGE_LABELS[stage] ?? null,
          })
          .where(eq(buildProjects.id, buildId));

        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'stage',
          message: STAGE_LABELS[stage] ?? stage,
        });
      },
      /* The model's own words, as it starts writing rather than afterwards. */
      onNarration: async (text) => {
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'say',
          message: text.slice(0, 2_000),
        });
      },
      /* Named as it is written, not listed afterwards. */
      onFile: async (path) => {
        if (!firstFileRecorded) {
          firstFileRecorded = true;
          await performance.mark('first_file', path);
        }
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'file',
          message: path,
          path,
        });
      },
    });

  let firstFileRecorded = false;
  await performance.mark('generation_started', model.key);
  let generated;
  try {
    generated = await generateWith(model);
  } catch (error) {
    const normalized = toRekluError(error);
    const mayFallback = normalized.retryable && (!request.modelKey || request.modelKey === 'auto');
    if (!mayFallback) throw error;

    const attempted = [model.key];
    let lastError: unknown = error;
    let completed = false;

    /* Free providers are capacity-constrained. Try several distinct coding
     * models so one overloaded endpoint does not strand an otherwise valid build. */
    for (let fallbackAttempt = 0; fallbackAttempt < 3; fallbackAttempt++) {
      const fallback = await pickModel(undefined, attempted, images.length > 0).catch(
        () => undefined,
      );
      if (!fallback) break;
      attempted.push(fallback.key);
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'say',
        message: `${model.displayName} could not respond. Continuing with ${fallback.displayName}.`,
      });
      logger.warn('Build model failed; retrying with fallback', {
        buildId,
        failedModel: model.key,
        fallbackModel: fallback.key,
        error: toRekluError(lastError).message,
      });
      model = fallback;
      try {
        generated = await generateWith(model);
        completed = true;
        break;
      } catch (fallbackError) {
        lastError = fallbackError;
        if (!toRekluError(fallbackError).retryable) throw fallbackError;
      }
    }
    if (!completed) throw lastError;
  }

  if (!generated) throw errors.internal('Build generation returned no result.');
  await meterBuildCall(
    model,
    generated.usage,
    'Build generation',
    !request.modelKey || request.modelKey === 'auto',
  );
  await performance.mark('generation_completed', `${generated.files.length} files`);

  if (generated.files.length === 0) {
    /*
     * Reported, not just recorded. This wrote a status nobody was looking at
     * and returned, so the one case where the model plainly failed looked
     * identical to success.
     */
    /*
     * What actually happened, not a guess. The old message told everyone to
     * describe the app in more detail; the briefs this happens to are already
     * long, and the commonest cause is a model spending its whole output budget
     * on a plan — for which more detail is the wrong direction.
     */
    const detail = describeEmptyGeneration(generated.diagnostics, generated.rejected.length);

    logger.warn('Generation produced no files', {
      buildId,
      model: model.key,
      ...generated.diagnostics,
    });

    await db
      .update(buildProjects)
      .set({ status: 'failed', statusDetail: detail })
      .where(eq(buildProjects.id, buildId));

    revalidatePath(`/build/${buildId}`);
    return { ok: false, message: detail, fileCount: 0 };
  }

  // An edit must not delete files it did not mention.
  let merged = mergeTree(existing, generated.files);

  /*
   * A second pass, for the things a single prompt does badly.
   *
   * Asked to implement features and art direct at once, a model spends its
   * attention on the features and reaches for the layout it has seen most.
   * Splitting the two is the difference between an application that renders and
   * one with a point of view.
   *
   * First generation only. On an edit the design already exists and the person
   * asked for a change, not a redesign — re-running this would quietly undo
   * whatever they had settled on.
   */
  const firstGeneration = existing.length === 0;

  if (firstGeneration && buildPath.path === 'agentic' && needsDesignPass(brief.target)) {
    await db
      .update(buildProjects)
      .set({
        status: 'generating',
        statusDetail: STAGE_LABELS.designing ?? 'Designing',
      })
      .where(eq(buildProjects.id, buildId));

    try {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message: STAGE_LABELS.designing ?? 'Designing the interface',
      });

      const contract = createDesignContract(brief, plan);
      const designModel = await pickDesignModel(model).catch(() => model);
      const designed = await runDesignPass({
        brief,
        files: merged,
        model: designModel,
        contract,
        designEngineV3,
        designEngineV4,
        designEngineV5,
      });
      await meterBuildCall(designModel, designed.usage, 'Build design pass');
      if (designed.files.length > 0) {
        merged = mergeTree(merged, designed.files);
        logger.info('Design pass revised files', {
          buildId,
          changed: designed.changed,
        });
      }

      /*
       * Correct structural styling before judging aesthetics. A design pass can
       * emit hundreds of Tailwind classes but forget to activate Tailwind in
       * globals.css; source then looks richly styled while the browser receives
       * only the handwritten rules. Normalization makes the critic review the
       * artifact that will actually be previewed.
       */
      merged = [...normalizeGeneratedTree(merged)];

      /*
       * A design director needs an acceptance pass. The first rewrite can still
       * be attractive in source while shipping the exact failures a user sees:
       * an empty first viewport, “no products yet” as the main sales section,
       * or no action at all. Run one bounded critic-guided revision; never loop
       * indefinitely on aesthetic judgment.
       */
      const findings = auditDesignQuality(brief, merged);
      const blockingFindings = findings.filter((finding) => finding.severity === 'blocking');
      if (blockingFindings.length > 0) {
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'stage',
          message: `Design review found ${blockingFindings.length} blocking issue${blockingFindings.length === 1 ? '' : 's'}; refining the interface`,
        });

        const refined = await runDesignPass({
          brief,
          files: merged,
          model: designModel,
          contract,
          designEngineV3,
          designEngineV4,
          designEngineV5,
          feedback: blockingFindings,
        });
        await meterBuildCall(designModel, refined.usage, 'Build design refinement');
        if (refined.files.length > 0) {
          merged = mergeTree(merged, refined.files);
          logger.info('Design critic revision updated files', {
            buildId,
            changed: refined.changed,
            findings: blockingFindings.map((finding) => finding.code),
          });
        }

        const remaining = auditDesignQuality(brief, merged);
        if (remaining.length > 0) {
          logger.warn('Design critic findings remain after the bounded revision', {
            buildId,
            findings: remaining.map((finding) => finding.code),
          });
        }
      } else if (findings.length > 0) {
        logger.info('Design review found advisory issues; skipping an extra model pass', {
          buildId,
          findings: findings.map((finding) => finding.code),
        });
      }
    } catch (error) {
      /*
       * Never fatal. A working application that looks plain is worth more than
       * no application, and the person asked for the app — the design pass is
       * Reklu's idea, so its failure is Reklu's to absorb.
       */
      logger.warn('Design pass failed; keeping the generated design', {
        buildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let designAnalytics: Record<string, unknown> | undefined;
  if (isVisualTarget(brief.target)) {
    const genericity = evaluateGenericity(merged);
    designAnalytics = {
      directionId: designEngineV4?.selection.profile ?? designEngineV3.selected.id,
      conceptName: designEngineV4?.dna.visualDirection ?? designEngineV3.selected.conceptName,
      displayFont: designDNA.typography.display,
      paletteStrategy: designEngineV4
        ? designEngineV4.dna.colors.primary
        : designEngineV3.selected.paletteDirection,
      genericityScore: genericity.score,
      scoreSource: 'source-heuristics-not-rendered-benchmark',
      genericityFlags: genericity.genericityIssues.map((issue) => issue.code),
      rejected: genericity.rejected,
      evaluatedAt: new Date().toISOString(),
    };
    await db
      .update(buildProjects)
      .set({
        codebaseAnalysis: {
          ...storedAnalysis,
          productDesignContext: productContext,
          designDNA,
          designEngineV3,
          ...(designEngineV4 ? { designEngineV4 } : {}),
          ...(designEngineV5 ? { designEngineV5 } : {}),
          informationArchitecture,
          designAnalytics,
        },
      })
      .where(eq(buildProjects.id, buildId));
    logger.info('Design source analytics', {
      buildId,
      direction: designAnalytics.directionId,
      genericityScore: genericity.score,
      rejected: genericity.rejected,
    });
  }
  await performance.mark(
    'design_polish_completed',
    buildPath.path === 'fast' ? 'deferred until after first preview' : undefined,
  );

  // Spec §35: bake the mapping in at generation time. Retrofitting it later
  // would mean regenerating every existing project.
  /*
   * The mark goes into the tree, not into the serving of it: it belongs to the
   * application the same way any other file does, so it shows in the code view
   * and travels with a GitHub export. A badge that existed only in the preview
   * would be a claim about the deployed site that was not true of it.
   */
  /*
   * Before anything runs it. A tree that imports `@/components/Header` with a
   * tsconfig that maps `@/` nowhere is complete, plausible, and does not
   * compile — and the reader meets that as a white frame rather than as a
   * missing line in a config file.
   */
  let resolved = normalizeGeneratedTree(
    designEngineV4 ? compileDesignTree(merged, designEngineV4, designEngineV5) : merged,
  );

  /*
   * TypeScript cannot see a hydration mismatch. Generated cart/theme providers
   * often read localStorage in a useState initializer, so the server renders an
   * empty tree while the browser's very first render contains stored items.
   * Repair that source before the preview can be called ready.
   */
  const hydrationFindings = hydrationSafetyIssues(resolved);
  if (hydrationFindings.length > 0) {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'stage',
      message: 'Correcting server/client first-render mismatch before preview',
    });
    const corrected = await generateFiles({
      brief,
      prompt: [
        'Correct only the hydration-safety problems in this existing Next.js application.',
        ...hydrationFindings.map((finding) => `- ${finding.message}`),
        'The server render and the first client render must have identical markup.',
        'Initialize cart, theme and persisted state with deterministic literals. Read browser storage in useEffect after mount, then update state.',
        'A context provider must return the same outer element tree before and after hydration. Preserve design, behavior and public APIs.',
        'Emit every changed file and nothing unrelated.',
      ].join('\n'),
      model,
      requireFiles: true,
      existingFiles: resolved,
      designDNA,
      designEngineV4,
      designEngineV5,
      report: async (stage) => {
        await db
          .update(buildProjects)
          .set({
            status: 'generating',
            statusDetail: STAGE_LABELS[stage] ?? 'Repairing runtime',
          })
          .where(eq(buildProjects.id, buildId));
      },
    });
    resolved = normalizeGeneratedTree(
      designEngineV4
        ? compileDesignTree(mergeTree(resolved, corrected.files), designEngineV4, designEngineV5)
        : mergeTree(resolved, corrected.files),
    );
    if (hydrationSafetyIssues(resolved).length > 0) {
      throw errors.validation(
        'The generated app still contains browser-derived initial state that would cause a hydration error. Reklu stopped before publishing a broken preview.',
      );
    }
  }

  /*
   * Design passes can revise a working page into one that imports components
   * they forgot to emit. Validate the final designed tree as well as the raw
   * generation, using the same provider-neutral closure check. This also makes
   * repair requests for historical broken builds self-healing: the existing
   * missing imports are included in the context and must be closed before a
   * new checkpoint can be called ready.
   */
  const missingAfterDesign = unresolvedLocalImports(resolved);
  if (missingAfterDesign.length > 0) {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'say',
      message: `The generated page references ${missingAfterDesign.length} local file${
        missingAfterDesign.length === 1 ? '' : 's'
      } that were not written. Completing them before preview.`,
    });

    const completed = await generateFiles({
      brief,
      prompt: [
        'Complete this existing application without changing its design.',
        'These local imports do not resolve:',
        ...missingAfterDesign.map((entry) => `- ${entry.importer} imports ${entry.reference}`),
        'Emit only the missing modules or importing files that must be corrected.',
      ].join('\n'),
      model,
      requireFiles: true,
      existingFiles: resolved,
      designDNA,
      designEngineV4,
      designEngineV5,
      report: async (stage) => {
        await db
          .update(buildProjects)
          .set({
            status: 'generating',
            statusDetail: STAGE_LABELS[stage] ?? null,
          })
          .where(eq(buildProjects.id, buildId));
      },
      onFile: async (path) => {
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'file',
          message: path,
          path,
        });
      },
    });

    resolved = normalizeGeneratedTree(mergeTree(resolved, completed.files));
  }

  /*
   * The photographs, drawn from what the page says they show.
   *
   * After the repairs and before the badge, because a picture is content and
   * the badge is a mark on top of finished content. A build whose images fail
   * still ships: the application is written and working, and what is missing is
   * a photograph.
   */
  const illustrated = request.repairPass
    ? { files: resolved, generated: 0, failures: [] }
    : await drawArtwork(
        resolved,
        `${brief.product} — ${brief.summary}`,
        (request, imagePrompt) =>
          drawOne(request, imagePrompt, workspace.workspaceId, (message) =>
            recordStep({
              buildId,
              workspaceId: workspace.workspaceId,
              kind: 'stage',
              message,
            }),
          ),
        (message) =>
          recordStep({
            buildId,
            workspaceId: workspace.workspaceId,
            kind: 'stage',
            message,
          }),
        buildPath.path === 'fast'
          ? {
              priority: 'critical',
              maxAssets: 6,
              artDirection: designEngineV5
                ? {
                    photography: designEngineV5.artDirection.photographyDirection,
                    palette: designEngineV5.artDirection.paletteDirection,
                    composition: designEngineV5.assetPlan[0]?.composition,
                  }
                : undefined,
            }
          : {
              priority: 'all',
              maxAssets: 8,
              artDirection: designEngineV5
                ? {
                    photography: designEngineV5.artDirection.photographyDirection,
                    palette: designEngineV5.artDirection.paletteDirection,
                    composition: designEngineV5.assetPlan[0]?.composition,
                  }
                : undefined,
            },
      );
  await performance.mark(
    'assets_completed',
    buildPath.path === 'fast'
      ? `${illustrated.generated} critical asset${illustrated.generated === 1 ? '' : 's'} fulfilled; optional assets deferred`
      : `${illustrated.generated} generated`,
  );

  for (const failure of illustrated.failures) {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'say',
      message: `Could not draw ${failure.path.replace(/^public/, '')}: ${failure.reason.slice(0, 200)}`,
    });
  }

  const branded = addMadeWithBadge(illustrated.files);
  const instrumented = instrumentForVisualSelection(branded);

  await createCheckpoint({
    buildProjectId: buildId,
    workspaceId: workspace.workspaceId,
    userId: user.id,
    files: instrumented.files,
    prompt,
    changeSummary: generated.commentary.slice(0, 200) || 'Generated files',
    modelKey: model.key,
  });
  await performance.mark('checkpoint_completed');

  await db
    .update(buildProjects)
    .set({
      status: 'ready',
      statusDetail: null,
      codebaseAnalysis: {
        ...storedAnalysis,
        productDesignContext: productContext,
        designDNA,
        designEngineV3,
        ...(designEngineV4
          ? {
              designEngineV4,
              ...(designEngineV5 ? { designEngineV5 } : {}),
              designQuality: {
                status: 'pending',
                reason: 'Preview readiness is not visual approval; rendered checks pending.',
              },
            }
          : {}),
        informationArchitecture,
        sourceMap: instrumented.sourceMap,
        ...(designAnalytics ? { designAnalytics } : {}),
      },
    })
    .where(eq(buildProjects.id, buildId));

  /*
   * A partial model response can contain nineteen perfectly valid files and no
   * route. Saving that as "ready" produces a Next server whose only page is its
   * framework 404. Repair the runnable shell now, while the generating model
   * and brief are still available, instead of making Preview discover it later.
   */
  const missingEntry = previewEntryProblem(instrumented.files);
  if (missingEntry) {
    if (!request.repairPass) {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'say',
        message: 'The generated files are missing a runnable homepage. Adding it now.',
      });

      return runGeneration(buildId, {
        instruction:
          `${missingEntry}\n\nAdd the missing runnable entry using the existing components and ` +
          'design. Change nothing unrelated.',
        origin: 'auto',
        repairPass: true,
        modelKey: request.modelKey,
      });
    }

    await db
      .update(buildProjects)
      .set({ status: 'failed', statusDetail: missingEntry })
      .where(eq(buildProjects.id, buildId));
    revalidatePath(`/build/${buildId}`);
    return {
      ok: false,
      message: missingEntry,
      fileCount: instrumented.files.length,
    };
  }

  /*
   * Into the running container, not just into the database.
   *
   * This is what makes an edit appear. Reloading the frame was never enough:
   * the frame was reloading a server that had never been told anything changed,
   * so it re-served exactly what it had. The change was real, was in the code
   * view, and was nowhere on the screen.
   */
  await performance.mark('preview_sync_started');
  const running = await syncPreview({
    buildProjectId: buildId,
    workspaceId: workspace.workspaceId,
    report: (_stage, message) =>
      recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message: message ?? 'Updating the preview',
      }),
  });

  if (running) {
    await performance.mark('preview_updated', 'running sandbox synchronized');
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'stage',
      message: 'Preview updated',
    });

    /*
     * Asked before anybody else has to find out.
     *
     * `next dev` reports type errors and keeps serving; `next build` refuses.
     * So a type error is invisible for as long as somebody is looking at the
     * preview and fatal the moment they publish — and the person meets it as a
     * failed publish naming a file they never opened. Better to ask the
     * compiler now, while the container is up and the model still has the
     * context that produced the code.
     *
     * Once. A second failure is reported rather than retried: the same
     * correction attempted repeatedly is how a build spends real money going
     * nowhere.
     */
    if (!request.repairPass) {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message: 'Checking the types',
      });

      const problems = await typecheckPreview({
        buildProjectId: buildId,
        workspaceId: workspace.workspaceId,
      });
      await performance.mark('validation_completed', problems ? 'type errors found' : 'passed');

      if (problems) {
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'say',
          message: 'The compiler found type errors. Fixing them before you see them.',
        });

        return runGeneration(buildId, {
          instruction:
            'The TypeScript compiler reports these errors. Fix every one of them and ' +
            `change nothing else.\n\n${problems}`,
          origin: 'auto',
          repairPass: true,
        });
      }
    }
  }

  /*
   * Without this the files exist in the database and not on the screen. The
   * generation worked, the page did not know, and the button read as broken.
   */
  revalidatePath(`/build/${buildId}`);

  await recordStep({
    buildId,
    workspaceId: workspace.workspaceId,
    kind: 'note',
    message: `Wrote ${instrumented.files.length} file${
      instrumented.files.length === 1 ? '' : 's'
    }.`,
  });
  await performance.mark('build_completed', `${instrumented.files.length} files`);

  if (running && designEngineV4) scheduleDesignWork(buildId, workspace.workspaceId, user.id);

  return {
    ok: true,
    message: `Generated ${instrumented.files.length} file${
      instrumented.files.length === 1 ? '' : 's'
    }.`,
    fileCount: instrumented.files.length,
  };
}

async function visuallyReviewPreview(
  buildId: string,
  workspaceId: string,
): Promise<Awaited<ReturnType<typeof startPreview>> | undefined> {
  const [project] = await db
    .select({
      brief: buildProjects.brief,
      currentVersionId: buildProjects.currentVersionId,
      codebaseAnalysis: buildProjects.codebaseAnalysis,
    })
    .from(buildProjects)
    .where(and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspaceId)))
    .limit(1);

  if (!project?.currentVersionId) return undefined;
  const analysis = (project.codebaseAnalysis ?? {}) as Record<string, unknown>;
  if (analysis.visualReviewedVersionId === project.currentVersionId) return undefined;

  const brief = (project.brief as BuildBrief | null) ?? fallbackBrief('Improve this website.');
  if (brief.target !== 'website') return undefined;

  const model = await pickVisionModel();
  const screenshot = model
    ? await captureRenderedPreview({ buildProjectId: buildId, workspaceId })
    : undefined;
  if (!model || !screenshot) return undefined;

  let review = await reviewRenderedDesign({
    brief,
    contract: createDesignContract(brief),
    screenshot,
    model,
  });

  await recordStep({
    buildId,
    workspaceId,
    kind: 'note',
    message: `Visual QA: ${review.score}/100 — ${review.summary || review.verdict}.`,
  });

  const needsRevision =
    review.verdict === 'revise' &&
    (review.findings.length > 0 || (review.criticalFindings?.length ?? 0) > 0);
  let updatedPreview: Awaited<ReturnType<typeof startPreview>> | undefined;
  if (needsRevision) {
    const previous = (await listCheckpoints(buildId, workspaceId)).find(
      (version) => version.id === project.currentVersionId,
    );
    await recordStep({
      buildId,
      workspaceId,
      kind: 'say',
      message:
        'The Website Agent found visible layout issues and is applying one focused polish pass.',
    });
    await runGeneration(buildId, {
      instruction: visualRevisionPrompt(review),
      origin: 'auto',
      repairPass: true,
    });

    const revised = await startPreview({
      buildProjectId: buildId,
      workspaceId,
    });
    updatedPreview = revised;
    let visuallyRegressed = false;
    if (revised.installed && revised.ready) {
      const after = await captureRenderedPreview({
        buildProjectId: buildId,
        workspaceId,
      });
      if (after) {
        const secondReview = await reviewRenderedDesign({
          brief,
          contract: createDesignContract(brief),
          screenshot: after,
          model,
        });
        visuallyRegressed = secondReview.score < review.score;
        if (!visuallyRegressed) review = secondReview;
      }
    }
    if (!revised.installed || !revised.ready || visuallyRegressed) {
      if (previous) {
        const { user } = await getAppContext();
        await restoreCheckpoint({
          buildProjectId: buildId,
          workspaceId,
          userId: user.id,
          version: previous.version,
        });
        updatedPreview = await startPreview({
          buildProjectId: buildId,
          workspaceId,
        });
      }
      await recordStep({
        buildId,
        workspaceId,
        kind: 'note',
        message:
          'The visual polish failed validation, so the previous working design was restored.',
      });
    }
  }

  const [latest] = await db
    .select({
      currentVersionId: buildProjects.currentVersionId,
      codebaseAnalysis: buildProjects.codebaseAnalysis,
    })
    .from(buildProjects)
    .where(eq(buildProjects.id, buildId))
    .limit(1);
  await db
    .update(buildProjects)
    .set({
      codebaseAnalysis: {
        ...((latest?.codebaseAnalysis ?? {}) as Record<string, unknown>),
        visualReviewedVersionId: latest?.currentVersionId,
        visualReviewScore: review.score,
        visualReviewVerdict: review.verdict,
      },
    })
    .where(eq(buildProjects.id, buildId));
  return updatedPreview;
}

/** Start (or restart) the preview for a build. */
export async function startPreviewAction(
  buildId: string,
): Promise<{ url: string | null; output: string; error?: string }> {
  const { workspace, user } = await getAppContext();
  await recordPersistentPerformance(buildId, workspace.workspaceId, 'preview_action_started');

  /* The layout of the tree, which is one of the reasons a server never starts. */
  let tree = await loadTree(buildId, workspace.workspaceId);

  try {
    /*
     * Persist deterministic manifest repairs before provisioning anything.
     * startPreview also normalizes defensively, but keeping that correction
     * only inside a disposable sandbox meant every restart restored the bad
     * package.json and paid for the same failed install again.
     */
    const normalizedTree = normalizeGeneratedTree(tree);
    const originalManifest = tree.find((file) => file.path === 'package.json')?.content;
    const normalizedManifest = normalizedTree.find((file) => file.path === 'package.json')?.content;
    if (normalizedManifest && normalizedManifest !== originalManifest) {
      const checkpoint = await createCheckpoint({
        buildProjectId: buildId,
        workspaceId: workspace.workspaceId,
        userId: user.id,
        files: normalizedTree,
        changeSummary: 'Repaired preview manifest before dependency installation',
        checksPassed: null,
      });
      tree = normalizedTree;
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'note',
        message: `Normalized dependency versions in checkpoint ${checkpoint.version.version} before preview.`,
      });
    }

    /*
     * Repair an incomplete generated tree before spending time provisioning a
     * sandbox. A Next process with configs and components but no page starts
     * perfectly and serves only its own 404 screen — exactly the shape that
     * used to be reported as a successful preview.
     */
    const missingEntry = previewEntryProblem(tree);
    if (missingEntry) {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'say',
        message: 'The generated application has no runnable homepage. Adding it now.',
      });

      await runGeneration(buildId, {
        instruction:
          `${missingEntry}\n\nAdd the missing runnable entry using the existing components and ` +
          'design. Change nothing unrelated.',
        origin: 'auto',
        repairPass: true,
      });

      tree = await loadTree(buildId, workspace.workspaceId);
      const stillMissing = previewEntryProblem(tree);
      if (stillMissing) {
        return { url: null, output: stillMissing, error: stillMissing };
      }
    }

    let result = await startPreview({
      buildProjectId: buildId,
      workspaceId: workspace.workspaceId,
      report: async (stage) => {
        await recordPersistentPerformance(
          buildId,
          workspace.workspaceId,
          stage === 'installing_dependencies'
            ? 'dependency_install_started'
            : 'dev_server_starting',
        );
        await db
          .update(buildProjects)
          .set({
            status: stage === 'installing_dependencies' ? 'installing' : 'ready',
          })
          .where(eq(buildProjects.id, buildId));
      },
    });

    if (!result.installed) {
      // Dependencies failing is a real, readable failure — not a generic error.
      await db
        .update(buildProjects)
        .set({
          status: 'failed',
          statusDetail: describeInstallFailure(result.output),
        })
        .where(
          and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
        );
      return {
        url: null,
        output: result.output,
        /* The cause, where npm's own output names one. */
        error: describeInstallFailure(result.output),
      };
    }

    result = await repairPreviewCompilation({
      initial: result,
      readLog: () => previewLogs(buildId, workspace.workspaceId),
      repair: async (compileError, attempt) => {
        await recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'say',
          message: `Repairing preview compilation (attempt ${attempt} of 3).`,
        });
        await runGeneration(buildId, {
          instruction:
            'Fix the current preview compiler or page-render failure using the existing project files. ' +
            'For missing local imports, find the actual file exporting the symbol; do not invent a path. ' +
            'For unknown Tailwind utilities, align the utility with the existing theme configuration. ' +
            'If an external service or database is not configured, do not initialize it while rendering ' +
            'the marketing homepage. Guard the integration and render realistic preview fixtures instead. ' +
            'Preserve the design and unrelated files.\n\n' +
            compileError,
          origin: 'auto',
          repairPass: true,
        });
      },
      restart: () =>
        startPreview({
          buildProjectId: buildId,
          workspaceId: workspace.workspaceId,
        }),
    });

    if (!result.installed) {
      await db
        .update(buildProjects)
        .set({
          status: 'failed',
          statusDetail: describeInstallFailure(result.output),
        })
        .where(
          and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
        );
      return {
        url: null,
        output: result.output,
        error: describeInstallFailure(result.output),
      };
    }

    if (!result.ready) {
      /*
       * A URL to nothing is worse than no URL. The frame renders white and the
       * proxy answers "Bad Gateway", and neither says which of a dozen things
       * went wrong — so the reason is named here instead.
       */
      return {
        url: null,
        output: result.output,
        error: describeStartupFailure(
          result.output,
          tree.map((file) => file.path),
        ),
      };
    }

    /*
     * First preview is a hard product boundary. Visual review used to run here
     * before returning the URL, adding a screenshot, vision call, possible
     * rewrite, restart and second screenshot to the blank-screen wait. Polish
     * is intentionally deferred; a durable background job will own it.
     */
    await recordPersistentPerformance(buildId, workspace.workspaceId, 'first_preview', result.url);
    // Request completion releases the preview immediately; Redis owns the actual work.
    // Captured IDs only: no request-scoped auth calls inside the after callback.
    scheduleDesignWork(buildId, workspace.workspaceId, user.id);
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'note',
      message:
        'Preview ready. This confirms the application runs, not that visual quality is approved.',
    });

    return {
      url: result.ready ? result.url : null,
      output: result.output,
      ...(!result.ready
        ? {
            error: describeStartupFailure(
              result.output,
              tree.map((file) => file.path),
            ),
          }
        : {}),
    };
  } catch (error) {
    if (isRekluError(error)) return { url: null, output: '', error: error.userMessage };

    logger.error('Preview failed to start', { error, buildId });

    /*
     * The actual reason, not a category.
     *
     * This returned "Preview could not start." and discarded the message, so a
     * missing image, a refused daemon, an unreachable network and a permission
     * problem were one indistinguishable sentence — leaving the only route to
     * the cause a server log the person looking at the screen cannot read.
     */
    const detail = error instanceof Error ? error.message : String(error);
    return {
      url: null,
      output: '',
      error: `Preview could not start. ${detail}`.slice(0, 500),
    };
  }
}

export async function stopPreviewAction(buildId: string): Promise<void> {
  const { workspace } = await getAppContext();
  await stopPreview(buildId, workspace.workspaceId);
}

export interface ExportState {
  readonly url?: string;
  readonly status?: string;
  readonly detail?: string;
  readonly error?: string;
}

/**
 * Export a build to a connected service (spec §37–§38).
 *
 * Reports a missing connection as setup rather than failure: the user has not
 * done something wrong, they have not connected the service yet, and the
 * message says which one and where to go (spec §25).
 */
async function runExport(
  buildId: string,
  provider: 'github' | 'vercel',
  run: (input: {
    buildProjectId: string;
    workspaceId: string;
    userId: string;
    connectionId: string;
    name: string;
  }) => Promise<{ url: string; status: string; detail: string }>,
): Promise<ExportState> {
  const { user, workspace } = await getAppContext();

  const [project] = await db
    .select({ name: buildProjects.name })
    .from(buildProjects)
    .where(and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)))
    .limit(1);

  if (!project) return { error: 'That build no longer exists.' };

  const connections = await listConnections(workspace.workspaceId);
  const connection = connections.find(
    (candidate) => candidate.provider === provider && candidate.status === 'connected',
  );

  if (!connection) {
    const label = provider === 'github' ? 'GitHub' : 'Vercel';
    return {
      error: `No ${label} account is connected. Connect one in Settings → Connections, then try again.`,
    };
  }

  try {
    const result = await run({
      buildProjectId: buildId,
      workspaceId: workspace.workspaceId,
      userId: user.id,
      connectionId: connection.id,
      name: project.name,
    });
    return { url: result.url, status: result.status, detail: result.detail };
  } catch (error) {
    if (isRekluError(error)) return { error: error.userMessage };
    // Provider messages ("repository already exists") are the useful part.
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Export failed', { error, buildId, provider });
    return { error: message };
  }
}

export async function exportToGitHubAction(buildId: string): Promise<ExportState> {
  return runExport(buildId, 'github', exportToGitHub);
}

export async function deployToVercelAction(buildId: string): Promise<ExportState> {
  return runExport(buildId, 'vercel', deployToVercel);
}

/**
 * What the preview server has printed since it started.
 *
 * Read on demand rather than streamed: a compile error is the only reason
 * anyone opens this, and it does not need to arrive within a second.
 */
export async function previewLogsAction(buildId: string): Promise<string> {
  const { workspace } = await getAppContext();
  return previewLogs(buildId, workspace.workspaceId);
}

/* ------------------------------------------------------------------------ */
/* Publishing (spec §40)                                                     */
/* ------------------------------------------------------------------------ */

export interface PublishState {
  readonly url?: string;
  readonly status?: string;
  readonly detail?: string;
  readonly error?: string;
  readonly slug?: string;
  readonly customDomain?: string;
  readonly domainStatus?: string;
  readonly domainDetail?: string;
  readonly dns?: { type: string; name: string; value: string };
  /** The build's own output when it failed, so the reason is readable. */
  readonly buildLog?: string;
  /**
   * False only when this instance cannot publish at all.
   *
   * A failed publish and an unconfigured server both used to arrive as an
   * `error` with no status, and the panel could not tell them apart — so one
   * failed build collapsed the whole panel to a single message, taking the
   * Publish button and the domain field with it.
   */
  readonly configured?: boolean;
}

/**
 * Turn a thrown thing into something a person can act on.
 *
 * A Drizzle failure carries the whole statement, and that statement was being
 * shown to the user: four lines of column names and two bound parameters, in a
 * panel whose job is to say whether the site is live. It published the schema
 * to whoever opened the tab and told them nothing they could use.
 *
 * Hiding it entirely was not better. "Check the server logs" asks someone to
 * go and find on a machine what the process already had in its hand. What is
 * useful is the database's own code and message — `42703: column x does not
 * exist` — which names the fault without reproducing the query.
 */
function databaseFault(error: unknown): { code?: string; message?: string } | undefined {
  /*
   * Drizzle wraps the driver's error, and how deep the real one sits varies by
   * driver and version — so this walks the chain rather than assuming a depth.
   */
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

function publishFailure(error: unknown): string {
  const fault = databaseFault(error);

  /*
   * 42P01: undefined_table. Almost always a deploy that shipped code expecting
   * a table nobody created — so the message gives the command that works on a
   * server with no checkout and no pnpm, which is what a deployed host is.
   */
  if (fault?.code === '42P01') {
    return (
      'This needs a database migration that has not been run on this server. ' +
      'Run it against the running container: ' +
      'docker exec -w /app/packages/database <container> ./node_modules/.bin/tsx src/migrate.ts ' +
      '— then the seed, src/seed/index.ts. See docs/DEPLOYMENT.md.'
    );
  }

  /*
   * 42703 is the same story one column deeper: the table arrived but a later
   * migration adding to it did not.
   */
  if (fault?.code === '42703') {
    return (
      `The database is missing a column this version expects (${fault.message ?? 'undefined column'}). ` +
      'Run the migration against the running container: ' +
      'docker exec -w /app/packages/database <container> ./node_modules/.bin/tsx src/migrate.ts'
    );
  }

  if (fault?.code) {
    /* The code and the driver's own sentence — never the statement. */
    return `The database rejected that request (${fault.code})${
      fault.message ? `: ${fault.message.split('\n')[0]?.slice(0, 200)}` : ''
    }.`;
  }

  const message = toRekluError(error).message;
  return /^Failed query:/i.test(message)
    ? 'The database rejected that request, and gave no code. The server logs have the statement.'
    : message;
}

/** What is live for this build right now, and what its domain is doing. */
export async function publicationStateAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  const availability = publishAvailability();
  if (!availability.available) return { configured: false, error: availability.detail };

  let record;
  try {
    record = await currentPublication(buildId, workspace.workspaceId);
  } catch (error) {
    logger.warn('Could not read the publication', { buildId, error });
    return { error: publishFailure(error) };
  }

  if (!record) return { status: 'none' };

  return {
    url: publicUrl(record),
    status: record.status,
    detail: record.statusDetail ?? undefined,
    buildLog: record.buildLog ? buildFailureDetail(record.buildLog) : undefined,
    slug: record.slug,
    customDomain: record.customDomain ?? undefined,
    domainStatus: record.domainStatus,
    domainDetail: record.domainDetail ?? undefined,
    ...(record.customDomain ? { dns: dnsInstructions(record.customDomain, record.slug) } : {}),
  };
}

/**
 * Put the build on the internet.
 *
 * Long — it installs, builds for production and starts a server — so it reports
 * each stage into the same log the generation writes to, rather than leaving a
 * button spinning with nothing to read.
 */
export async function publishAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    const result = await publishSite({
      buildProjectId: buildId,
      workspaceId: workspace.workspaceId,
      report: (message) =>
        recordStep({
          buildId,
          workspaceId: workspace.workspaceId,
          kind: 'stage',
          message,
        }),
    });

    revalidatePath(`/build/${buildId}`);
    return { url: result.url, status: result.status, detail: result.detail };
  } catch (error) {
    logger.warn('Publish failed', { buildId, error });
    return { error: publishFailure(error) };
  }
}

/**
 * Publish to the person's own Vercel account.
 *
 * The same deployment that Export performs, answering as a publish — because it
 * is one. Somebody deciding where their site lives is asking one question, and
 * splitting the answer across two panels made this look like a developer's
 * escape hatch rather than the other way to publish.
 *
 * Nothing of it runs on Reklu's server afterwards. That is the point of it, and
 * the reason to offer it beside the option that does.
 */
export async function publishToVercelAction(buildId: string): Promise<PublishState> {
  const result = await deployToVercelAction(buildId);

  if (result.error) return { error: result.error, status: 'failed' };

  return {
    ...(result.url ? { url: result.url } : {}),
    /*
     * Vercel reports a deployment as building for a while after it accepts one,
     * and the URL 404s until it finishes. Saying "live" then would be a claim
     * Reklu cannot make about somebody else's platform.
     */
    status: result.status === 'ready' ? 'live' : 'publishing',
    ...(result.detail ? { detail: result.detail } : {}),
  };
}

export async function unpublishAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    const result = await unpublishSite(buildId, workspace.workspaceId);
    revalidatePath(`/build/${buildId}`);
    return { status: 'stopped', detail: result.detail };
  } catch (error) {
    return { error: publishFailure(error) };
  }
}

export async function setDomainAction(buildId: string, domain: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  let result;
  try {
    result = await setCustomDomain(buildId, workspace.workspaceId, domain);
  } catch (error) {
    return { error: publishFailure(error) };
  }
  if (result.error) return { error: result.error };

  revalidatePath(`/build/${buildId}`);
  return publicationStateAction(buildId);
}

/**
 * Check the DNS and start serving the domain if it points here.
 *
 * Separate from adding it, because what happens between the two is somebody
 * editing DNS at their registrar and waiting — which is not something Reklu can
 * do or hurry.
 */
export async function checkDomainAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    await activateCustomDomain(buildId, workspace.workspaceId, (message) =>
      recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message,
      }),
    );
    revalidatePath(`/build/${buildId}`);
    return publicationStateAction(buildId);
  } catch (error) {
    return { error: publishFailure(error) };
  }
}

export async function removeDomainAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    await removeCustomDomain(buildId, workspace.workspaceId, (message) =>
      recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message,
      }),
    );
    revalidatePath(`/build/${buildId}`);
    return publicationStateAction(buildId);
  } catch (error) {
    return { error: publishFailure(error) };
  }
}

/**
 * Hand a failed publish back to the model.
 *
 * The build log names a file and a line, which is most of the fix. Reaching it
 * required opening a panel, reading a stack trace and describing it in a
 * sentence — work the log has already done.
 */
export async function fixPublishFailureAction(buildId: string): Promise<GenerateResult> {
  const { workspace } = await getAppContext();

  const record = await currentPublication(buildId, workspace.workspaceId);
  if (!record?.buildLog) {
    return {
      ok: false,
      message: 'There is no build failure to fix.',
      fileCount: 0,
    };
  }

  return generateBuildAction(buildId, {
    instruction:
      'The production build fails with the following output. Fix the cause and change ' +
      `nothing else.\n\n${buildFailureDetail(record.buildLog)}`,
    /* Reklu quoting a build log back at itself is not something a person said. */
    origin: 'auto',
  });
}
