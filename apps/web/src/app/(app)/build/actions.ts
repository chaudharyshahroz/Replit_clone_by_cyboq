'use server';

import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { loadRegistry, selectableModels, type RegisteredModel } from '@reklu/ai';
import {
  createCheckpoint,
  describeSelection,
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
} from '@reklu/build';
import { buildProjects, db } from '@reklu/database';
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
export async function generateBuildAction(buildId: string, prompt: string): Promise<void> {
  const { user, workspace } = await getAppContext();

  const [project] = await db
    .select()
    .from(buildProjects)
    .where(eq(buildProjects.id, buildId))
    .limit(1);

  if (!project || project.workspaceId !== workspace.workspaceId) {
    throw errors.notFound('Build project', buildId);
  }

  const model = await pickModel();
  const brief = (project.brief as never) ?? fallbackBrief(prompt);
  const existing = await loadTree(buildId, workspace.workspaceId);

  const generated = await generateFiles({
    brief,
    prompt,
    model,
    existingFiles: existing,
    report: async (stage) => {
      await db
        .update(buildProjects)
        .set({ status: stage === 'generating_files' ? 'generating' : 'planning' })
        .where(eq(buildProjects.id, buildId));
    },
  });

  if (generated.files.length === 0) {
    await db
      .update(buildProjects)
      .set({ status: 'failed', statusDetail: 'The model produced no files.' })
      .where(eq(buildProjects.id, buildId));
    return;
  }

  // An edit must not delete files it did not mention.
  const merged = mergeTree(existing, generated.files);

  // Spec §35: bake the mapping in at generation time. Retrofitting it later
  // would mean regenerating every existing project.
  const instrumented = instrumentForVisualSelection(merged);

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
    return { url: null, output: '', error: 'Preview could not start.' };
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
