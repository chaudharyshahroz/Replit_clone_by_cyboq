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
  stopPreview,
  type SourceMap,
  needsDesignPass,
  type BuildBrief,
  runDesignPass,
  previewLogs,
  addMadeWithBadge,
  repairAliasPaths,
  repairMissingDependencies,
  repairFontWeights,
} from '@reklu/build';
import { buildEvents, buildProjects, db } from '@reklu/database';
import { listConnections } from '@reklu/integrations';
import { sandboxStatus } from '@reklu/sandbox';
import { errors, isRekluError, logger, newId, slugify } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export interface BuildFormState {
  readonly error?: string;
}

async function pickModel(): Promise<RegisteredModel> {
  const registry = await loadRegistry();
  const allowed = selectableModels(registry, undefined);
  if (allowed.length === 0) {
    throw errors.notConfigured({
      feature: 'Build',
      requiredEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      docsPath: '/settings',
    });
  }
  return (
    allowed.find((m) => m.bestFor.includes('coding')) ??
    allowed.find((m) => m.bestFor.includes('reasoning')) ??
    allowed[0]!
  );
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
  prompt: string,
  /**
   * Whether a person typed this.
   *
   * The first generation is started by Reklu with an instruction nobody wrote
   * — "build it as described in the brief" — and showing that back as though
   * they had said it would be putting words in their mouth.
   */
  origin: 'user' | 'auto' = 'user',
): Promise<GenerateResult> {
  try {
    return await runGeneration(buildId, prompt, origin);
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

async function runGeneration(
  buildId: string,
  prompt: string,
  origin: 'user' | 'auto',
): Promise<GenerateResult> {
  const { user, workspace } = await getAppContext();

  /* What was asked, kept where the answer will appear. */
  if (origin === 'user') {
    await recordStep({
      buildId,
      workspaceId: workspace.workspaceId,
      kind: 'ask',
      message: prompt.slice(0, 2_000),
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

  const model = await pickModel();
  /*
   * Typed, not `never`. The cast used to erase the brief entirely, so the
   * target — which decides the stack, the standards and whether a design pass
   * runs — could not be read from it at all.
   */
  const brief = (project.brief as BuildBrief | null) ?? fallbackBrief(prompt);
  const existing = await loadTree(buildId, workspace.workspaceId);

  const generated = await generateFiles({
    brief,
    prompt,
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
  const resolved = repairFontWeights(repairMissingDependencies(repairAliasPaths(merged)));
  const branded = addMadeWithBadge(resolved);
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

/**
 * Revise the build from a visually selected element (spec §35).
 *
 * The selection is resolved to a file and line through the source map, so
 * "make this card smaller" reaches a specific place rather than a search.
 */
export async function editSelectionAction(
  buildId: string,
  elementIdentifier: string,
  instruction: string,
): Promise<{ error?: string }> {
  const { workspace } = await getAppContext();

  const [project] = await db
    .select({ id: buildProjects.id, sourceMap: buildProjects.codebaseAnalysis })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
    )
    .limit(1);

  if (!project) return { error: 'Build not found.' };

  const analysis = (project.sourceMap ?? {}) as { sourceMap?: SourceMap };
  const location = analysis.sourceMap
    ? resolveElement(analysis.sourceMap, elementIdentifier)
    : undefined;

  if (!location) {
    return { error: 'That element could not be traced back to a source file.' };
  }

  const files = await loadTree(buildId, workspace.workspaceId);
  const prompt = [describeSelection(location, files), '', `Change requested: ${instruction}`].join(
    '\n',
  );

  await generateBuildAction(buildId, prompt);
  return {};
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
