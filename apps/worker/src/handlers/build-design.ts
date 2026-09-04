import { and, eq, sql } from 'drizzle-orm';
import { buildProjects, db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { logger } from '@reklu/shared';
import { loadRegistry, selectableModels } from '@reklu/ai';
import { findStockImage, generateImage } from '@reklu/create';
import {
  loadTree,
  drawArtwork,
  createCheckpoint,
  syncPreview,
  captureRenderedPreview,
  reviewRenderedDesign,
  createDesignContract,
  fallbackBrief,
  evaluatePremiumGate,
  DesignEngineV4Schema,
  type BuildBrief,
} from '@reklu/build';
import type { JobContext } from '@reklu/queue';

/** Runs after first preview; survives closing the tab. Concurrency and attempts are bounded. */
export async function buildDesignHandler(context: JobContext<'build_design'>) {
  const { buildProjectId, workspaceId, userId } = context.payload;
  let versionId = context.payload.versionId;
  const predicate = () =>
    and(
      eq(buildProjects.id, buildProjectId),
      eq(buildProjects.workspaceId, workspaceId),
      eq(buildProjects.currentVersionId, versionId),
    );
  const current = async () =>
    (await db.select().from(buildProjects).where(predicate()).limit(1))[0];
  const project = await current();
  if (!project) return { status: 'superseded' };
  const analysis = (project.codebaseAnalysis ?? {}) as Record<string, unknown>;
  const engine = DesignEngineV4Schema.safeParse(analysis.designEngineV4);
  if (!engine.success) return { status: 'legacy' };
  const brief = (project.brief as BuildBrief | null) ?? fallbackBrief('Build a website');
  await context.throwIfCancelled();
  await context.reportStage('creating_assets');
  const tree = await loadTree(buildProjectId, workspaceId);
  // Re-check after reading: do not apply a stale tree to a newer revision.
  if (!(await current())) return { status: 'superseded' };
  let calls = 0;
  const assets = await drawArtwork(
    tree,
    `${brief.product}: ${brief.summary}`,
    async (request, prompt) => {
      await context.throwIfCancelled();
      if (++calls > 8) throw new Error('Per-build asset budget reached (8 assets).');
      if (!(await current())) throw new Error('Design job superseded by a new edit.');
      const stock = await findStockImage({
        workspaceId,
        query: request.description,
        shape: request.shape,
      });
      if (stock)
        return { storageKey: stock.storageKey, contentType: stock.contentType, bytes: stock.bytes };
      const image = await generateImage({
        workspaceId,
        prompt,
        size:
          request.shape === 'portrait'
            ? '1024x1536'
            : request.shape === 'landscape'
              ? '1536x1024'
              : '1024x1024',
        quality: 'medium',
      });
      return { storageKey: image.storageKey, contentType: image.contentType, bytes: image.bytes };
    },
  );
  await context.throwIfCancelled();
  if (!(await current())) return { status: 'superseded' };
  if (assets.generated) {
    const saved = await createCheckpoint({
      buildProjectId,
      workspaceId,
      userId,
      expectedVersionId: versionId,
      files: assets.files,
      changeSummary: 'Fulfilled planned design assets after first preview',
    });
    versionId = saved.version.id;
  }
  await context.reportStage('updating_preview');
  await syncPreview({ buildProjectId, workspaceId });
  await context.reportStage('reviewing_design');
  let screenshot: Awaited<ReturnType<typeof captureRenderedPreview>> = undefined;
  let review: Awaited<ReturnType<typeof reviewRenderedDesign>> | undefined = undefined;
  let reviewUnavailable: string | undefined;
  try {
    await context.throwIfCancelled();
    if (!(await current())) return { status: 'superseded' };
    const [planRow] = await db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    const model = selectableModels(
      await loadRegistry(),
      planRow?.limits as PlanLimits | undefined,
    ).find((model) => model.supportsVision);
    screenshot = model ? await captureRenderedPreview({ buildProjectId, workspaceId }) : undefined;
    review =
      model && screenshot
        ? await reviewRenderedDesign({
            brief,
            contract: { ...createDesignContract(brief), concept: engine.data.dna.visualDirection },
            screenshot,
            model,
          })
        : undefined;
    if (!review)
      reviewUnavailable =
        'No permitted vision model or supported screenshot provider is available.';
  } catch (error) {
    logger.warn('Design review unavailable; quality remains pending', { buildProjectId, error });
    reviewUnavailable = 'The screenshot or visual review service failed. No approval was issued.';
  }
  await context.throwIfCancelled();
  const gate = evaluatePremiumGate({
    renders:
      screenshot && review
        ? [
            {
              width: screenshot.width,
              fullPage: false,
              score: review.score,
              criticalFindings: review.criticalFindings ?? [],
            },
          ]
        : [],
    assets: assets.failures.map((f) => ({
      id: f.path,
      critical: true,
      status: 'failed',
      naturalWidth: 0,
      naturalHeight: 0,
      relevance: 'unverified',
    })),
    assetsAudited: false,
    interactionsVerified: false,
  });
  // Merge only our key, conditionally on the version actually reviewed. Never overwrite DNA/source maps.
  const quality = {
    ...gate,
    versionId,
    reviewedAt: new Date().toISOString(),
    assetCalls: Math.min(calls, 8),
    assetFailures: assets.failures,
    review,
    reviewUnavailable,
    evidenceScope:
      'desktop screen only; full-page, responsive, decode and interaction verification still required',
  };
  await db
    .update(buildProjects)
    .set({
      codebaseAnalysis: sql`coalesce(${buildProjects.codebaseAnalysis}, '{}'::jsonb) || ${JSON.stringify({ designQuality: quality, designJobVersion: versionId })}::jsonb`,
    })
    .where(predicate());
  return quality;
}
