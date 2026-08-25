'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { loadRegistry, selectableModels, type RegisteredModel } from '@reklu/ai';
import {
  createCheckpoint,
  deployToVercel,
  describeSelection,
  exportToGitHub,
  fallbackBrief,
  generateBrief,
  generateFiles,
  instrumentForVisualSelection,
  loadTree,
  mergeTree,
  resolveElement,
  startPreview,
  syncPreview,
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
  drawArtwork,
  publicUrl,
  publishAvailability,
  publishSite,
  removeCustomDomain,
  setCustomDomain,
  unpublishSite,
  repairAliasPaths,
  repairMissingDependencies,
  repairFontWeights,
  repairStaticExport,
} from '@reklu/build';
import { buildEvents, buildProjects, db } from '@reklu/database';
import { listConnections } from '@reklu/integrations';
import { sandboxStatus } from '@reklu/sandbox';
import { errors, isRekluError, logger, newId, slugify, toRekluError } from '@reklu/shared';
import { generateImage } from '@reklu/create';
import { getAppContext } from '@/lib/auth-context';
import { loadAttachments } from '@/lib/files';
import { storage } from '@reklu/storage';

export interface BuildFormState {
  readonly error?: string;
}

async function pickModel(requested?: string): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  const allowed = selectableModels(registry, undefined);
  if (allowed.length === 0) {
    throw errors.notConfigured({
      feature: 'Build',
      requiredEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      docsPath: '/settings',
    });
  }
  /*
   * A chosen model is honoured, and an unavailable one falls back rather than
   * failing: the key names a model that may since have been disabled, and a
   * build is not the place to refuse work over a stale selection.
   */
  return (
    (requested ? allowed.find((m) => m.key === requested) : undefined) ??
    allowed.find((m) => m.bestFor.includes('coding')) ??
    allowed.find((m) => m.bestFor.includes('reasoning')) ??
    allowed[0]!
  );
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
  readonly textChanges?: readonly { readonly elementId: string; readonly text: string }[];
  /** Files attached to the message, already uploaded. */
  readonly fileIds?: readonly string[];
  /** A model chosen in the composer; absent means Reklu picks. */
  readonly modelKey?: string;
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

  if (prompt.length < 8) {
    return { error: 'Describe what you want built in a little more detail.' };
  }

  const status = sandboxStatus();
  if (!status.available) {
    return { error: status.detail };
  }

  let buildId: string;

  try {
    const model = await pickModel();
    const { brief, usedFallback } = await generateBrief({ prompt, model });

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
    logger.debug('Could not record a build step', { buildId: params.buildId, error });
  }
}

/** What the build is doing right now, for a screen that is watching it. */
export async function buildProgressAction(buildId: string): Promise<BuildProgress> {
  const { workspace } = await getAppContext();

  const [project] = await db
    .select({ status: buildProjects.status, statusDetail: buildProjects.statusDetail })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
    )
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
    const message = isRekluError(error)
      ? error.userMessage
      : 'Generation failed. Nothing was changed.';

    logger.error('Build generation failed', {
      buildId,
      error: error instanceof Error ? error.message : String(error),
    });

    await db
      .update(buildProjects)
      .set({ status: 'failed', statusDetail: message.slice(0, 500) })
      .where(eq(buildProjects.id, buildId));

    revalidatePath(`/build/${buildId}`);
    return { ok: false, message, fileCount: 0 };
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

  const analysis = (project.codebaseAnalysis ?? {}) as { sourceMap?: SourceMap };
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
          [`Attached file ${record.filename}:`, '```', record.extractedText.slice(0, 20_000), '```'].join(
            '\n',
          ),
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
  imagePrompt: string,
  shape: 'landscape' | 'square' | 'portrait',
  workspaceId: string,
): Promise<GeneratedFile['binary']> {
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

  const model = await pickModel(request.modelKey);
  /*
   * Typed, not `never`. The cast used to erase the brief entirely, so the
   * target — which decides the stack, the standards and whether a design pass
   * runs — could not be read from it at all.
   */
  const brief = (project.brief as BuildBrief | null) ?? fallbackBrief(request.instruction);
  const existing = await loadTree(buildId, workspace.workspaceId);

  const { prompt, images } = await composePrompt(
    request,
    project,
    existing,
    workspace.workspaceId,
    user.id,
  );

  const generated = await generateFiles({
    brief,
    prompt,
    images,
    model,
    existingFiles: existing,
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
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'file',
        message: path,
        path,
      });
    },
  });

  if (generated.files.length === 0) {
    /*
     * Reported, not just recorded. This wrote a status nobody was looking at
     * and returned, so the one case where the model plainly failed looked
     * identical to success.
     */
    const detail = generated.rejected.length > 0
      ? `The model produced no usable files. ${generated.rejected.length} were rejected as unsafe paths.`
      : 'The model produced no files. Try describing the app in more detail.';

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

  if (firstGeneration && needsDesignPass(brief.target)) {
    await db
      .update(buildProjects)
      .set({ status: 'generating', statusDetail: STAGE_LABELS.designing ?? 'Designing' })
      .where(eq(buildProjects.id, buildId));

    try {
      await recordStep({
        buildId,
        workspaceId: workspace.workspaceId,
        kind: 'stage',
        message: STAGE_LABELS.designing ?? 'Designing the interface',
      });

      const designed = await runDesignPass({ brief, files: merged, model });
      if (designed.files.length > 0) {
        merged = mergeTree(merged, designed.files);
        logger.info('Design pass revised files', {
          buildId,
          changed: designed.changed,
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
  const resolved = repairStaticExport(
    repairFontWeights(repairMissingDependencies(repairAliasPaths(merged))),
  );

  /*
   * The photographs, drawn from what the page says they show.
   *
   * After the repairs and before the badge, because a picture is content and
   * the badge is a mark on top of finished content. A build whose images fail
   * still ships: the application is written and working, and what is missing is
   * a photograph.
   */
  const illustrated = await drawArtwork(
    resolved,
    `${brief.product} — ${brief.summary}`,
    (imagePrompt, shape) =>
      drawOne(imagePrompt, shape, workspace.workspaceId),
    (message) =>
      recordStep({ buildId, workspaceId: workspace.workspaceId, kind: 'stage', message }),
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

  await db
    .update(buildProjects)
    .set({
      status: 'ready',
      statusDetail: null,
      codebaseAnalysis: { sourceMap: instrumented.sourceMap },
    })
    .where(eq(buildProjects.id, buildId));

  /*
   * Into the running container, not just into the database.
   *
   * This is what makes an edit appear. Reloading the frame was never enough:
   * the frame was reloading a server that had never been told anything changed,
   * so it re-served exactly what it had. The change was real, was in the code
   * view, and was nowhere on the screen.
   */
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
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'stage',
      message: 'Preview updated',
    });
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

  return {
    ok: true,
    message: `Generated ${instrumented.files.length} file${
      instrumented.files.length === 1 ? '' : 's'
    }.`,
    fileCount: instrumented.files.length,
  };
}

/** Start (or restart) the preview for a build. */
export async function startPreviewAction(
  buildId: string,
): Promise<{ url: string | null; output: string; error?: string }> {
  const { workspace } = await getAppContext();

  try {
    const result = await startPreview({
      buildProjectId: buildId,
      workspaceId: workspace.workspaceId,
      report: async (stage) => {
        await db
          .update(buildProjects)
          .set({ status: stage === 'installing_dependencies' ? 'installing' : 'ready' })
          .where(eq(buildProjects.id, buildId));
      },
    });

    if (!result.installed) {
      // Dependencies failing is a real, readable failure — not a generic error.
      return { url: null, output: result.output, error: 'Dependencies failed to install.' };
    }
    return { url: result.url, output: result.output };
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
    .where(
      and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
    )
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
}

/** What is live for this build right now, and what its domain is doing. */
export async function publicationStateAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  const availability = publishAvailability();
  if (!availability.available) return { error: availability.detail };

  const record = await currentPublication(buildId, workspace.workspaceId);
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
    ...(record.customDomain
      ? { dns: dnsInstructions(record.customDomain, record.slug) }
      : {}),
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
        recordStep({ buildId, workspaceId: workspace.workspaceId, kind: 'stage', message }),
    });

    revalidatePath(`/build/${buildId}`);
    return { url: result.url, status: result.status, detail: result.detail };
  } catch (error) {
    const failure = toRekluError(error);
    logger.warn('Publish failed', { buildId, error: failure.message });
    return { error: failure.message };
  }
}

export async function unpublishAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    const result = await unpublishSite(buildId, workspace.workspaceId);
    revalidatePath(`/build/${buildId}`);
    return { status: 'stopped', detail: result.detail };
  } catch (error) {
    return { error: toRekluError(error).message };
  }
}

export async function setDomainAction(buildId: string, domain: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  const result = await setCustomDomain(buildId, workspace.workspaceId, domain);
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
      recordStep({ buildId, workspaceId: workspace.workspaceId, kind: 'stage', message }),
    );
    revalidatePath(`/build/${buildId}`);
    return publicationStateAction(buildId);
  } catch (error) {
    return { error: toRekluError(error).message };
  }
}

export async function removeDomainAction(buildId: string): Promise<PublishState> {
  const { workspace } = await getAppContext();

  try {
    await removeCustomDomain(buildId, workspace.workspaceId, (message) =>
      recordStep({ buildId, workspaceId: workspace.workspaceId, kind: 'stage', message }),
    );
    revalidatePath(`/build/${buildId}`);
    return publicationStateAction(buildId);
  } catch (error) {
    return { error: toRekluError(error).message };
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
    return { ok: false, message: 'There is no build failure to fix.', fileCount: 0 };
  }

  return generateBuildAction(buildId, {
    instruction:
      'The production build fails with the following output. Fix the cause and change ' +
      `nothing else.\n\n${buildFailureDetail(record.buildLog)}`,
    /* Reklu quoting a build log back at itself is not something a person said. */
    origin: 'auto',
  });
}
