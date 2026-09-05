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
  runDesignPass,
  mergeTree,
  normalizeGeneratedTree,
  compileDesignTree,
  auditDesignQuality,
  type BuildBrief,
  type DesignQualityIssue,
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
  let sourceIssues = auditDesignQuality(brief, assets.files);
  await context.reportStage('updating_preview');
  await syncPreview({ buildProjectId, workspaceId });
  await context.reportStage('reviewing_design');
  let screenshot: Awaited<ReturnType<typeof captureRenderedPreview>> = undefined;
  let review: Awaited<ReturnType<typeof reviewRenderedDesign>> | undefined = undefined;
  let reviewModel: ReturnType<typeof selectableModels>[number] | undefined;
  let repairModel: ReturnType<typeof selectableModels>[number] | undefined;
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
    const permittedModels = selectableModels(
      await loadRegistry(),
      planRow?.limits as PlanLimits | undefined,
    );
    const rank = (candidate: (typeof permittedModels)[number]) =>
      (candidate.bestFor.includes('coding') ? 6 : 0) +
      (candidate.bestFor.includes('reasoning') ? 4 : 0) +
      Math.min(candidate.maxOutputTokens / 8_000, 2);
    repairModel = [...permittedModels].sort(
      (left, right) => rank(right) - rank(left) || left.sortOrder - right.sortOrder,
    )[0];
    reviewModel = permittedModels
      .filter((model) => model.supportsVision)
      .sort((left, right) => rank(right) - rank(left) || left.sortOrder - right.sortOrder)[0];
    screenshot = reviewModel
      ? await captureRenderedPreview({ buildProjectId, workspaceId })
      : undefined;
    review =
      reviewModel && screenshot
        ? await reviewRenderedDesign({
            brief,
            contract: { ...createDesignContract(brief), concept: engine.data.dna.visualDirection },
            screenshot,
            model: reviewModel,
          })
        : undefined;
    if (!review)
      reviewUnavailable =
        'No permitted vision model or supported screenshot provider is available.';
  } catch (error) {
    logger.warn('Design review unavailable; quality remains pending', { buildProjectId, error });
    reviewUnavailable = 'The screenshot or visual review service failed. No approval was issued.';
  }

  /*
   * The critic used to write down that a design was bad and stop. Complete the
   * architecture with one bounded targeted repair, then review the real result
   * again. This is deliberately one pass: visual judgment must not become an
   * unbounded autonomous loop.
   */
  if (
    repairModel &&
    (review?.verdict === 'revise' || sourceIssues.some((issue) => issue.severity === 'blocking')) &&
    (await current())
  ) {
    try {
      await context.throwIfCancelled();
      await context.reportStage('polishing_design');
      const feedback: DesignQualityIssue[] = [
        ...sourceIssues,
        ...(review?.criticalFindings ?? []).map((message, index) => ({
          code: `rendered-critical-${index + 1}`,
          severity: 'blocking' as const,
          message,
        })),
        ...(review?.findings ?? []).map((message, index) => ({
          code: `rendered-finding-${index + 1}`,
          severity: 'warning' as const,
          message,
        })),
        {
          code: 'preserve-verified-assets',
          severity: 'blocking' as const,
          message:
            'Keep every existing image src unchanged and do not add new media; correct composition, typography, spacing, contrast and cropping around the fulfilled assets.',
        },
      ];
      const polished = await runDesignPass({
        brief,
        files: assets.files,
        model: repairModel,
        contract: createDesignContract(brief),
        designEngineV4: engine.data,
        feedback,
      });
      if (polished.changed > 0) {
        const beforeReview = review;
        const revised = normalizeGeneratedTree(
          compileDesignTree(mergeTree(assets.files, polished.files), engine.data),
        );
        const revisedSourceIssues = auditDesignQuality(brief, revised);
        const previousBlockingCodes = new Set(
          sourceIssues
            .filter((issue) => issue.severity === 'blocking')
            .map((issue) => issue.code),
        );
        const revisedBlockingIssues = revisedSourceIssues.filter(
          (issue) => issue.severity === 'blocking',
        );
        const sourceRegressed =
          revisedBlockingIssues.length > previousBlockingCodes.size ||
          revisedBlockingIssues.some((issue) => !previousBlockingCodes.has(issue.code));
        const saved = await createCheckpoint({
          buildProjectId,
          workspaceId,
          userId,
          expectedVersionId: versionId,
          files: revised,
          changeSummary: 'Applied targeted fixes from rendered visual QA',
        });
        versionId = saved.version.id;
        await syncPreview({ buildProjectId, workspaceId });
        const revisedScreenshot = reviewModel
          ? await captureRenderedPreview({ buildProjectId, workspaceId })
          : undefined;
        const revisedReview =
          reviewModel && revisedScreenshot
            ? await reviewRenderedDesign({
                brief,
                contract: {
                  ...createDesignContract(brief),
                  concept: engine.data.dna.visualDirection,
                },
                screenshot: revisedScreenshot,
                model: reviewModel,
              })
            : undefined;
        const regressed =
          sourceRegressed ||
          (beforeReview
            ? !revisedReview ||
              revisedReview.score < beforeReview.score ||
              (revisedReview.criticalFindings?.length ?? 0) >
                (beforeReview.criticalFindings?.length ?? 0)
            : false);
        if (regressed) {
          const rollback = await createCheckpoint({
            buildProjectId,
            workspaceId,
            userId,
            expectedVersionId: versionId,
            files: assets.files,
            changeSummary: 'Restored the stronger design after visual QA regression',
          });
          versionId = rollback.version.id;
          await syncPreview({ buildProjectId, workspaceId });
          review = beforeReview;
        } else {
          sourceIssues = revisedSourceIssues;
          screenshot = revisedScreenshot;
          review = revisedReview;
        }
      }
    } catch (error) {
      logger.warn('Targeted rendered-design repair was unavailable', { buildProjectId, error });
      reviewUnavailable = 'The bounded targeted-fix pass failed; the original review was retained.';
    }
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
  const sourceFailures = sourceIssues
    .filter((issue) => issue.severity === 'blocking')
    .map((issue) => `${issue.code}: ${issue.message}`);
  const verifiedGate = {
    ...gate,
    status: sourceFailures.length ? ('needs_revision' as const) : gate.status,
    failures: [...sourceFailures, ...gate.failures],
  };
  // Merge only our key, conditionally on the version actually reviewed. Never overwrite DNA/source maps.
  const quality = {
    ...verifiedGate,
    versionId,
    reviewedAt: new Date().toISOString(),
    assetCalls: Math.min(calls, 8),
    assetFailures: assets.failures,
    review,
    reviewUnavailable,
    sourceIssues,
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
