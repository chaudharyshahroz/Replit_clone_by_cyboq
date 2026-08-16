/**
 * Deep Research as a background job.
 *
 * Deep mode runs two rounds over up to `RESEARCH_MAX_SOURCES` sources, which
 * can take minutes — longer than a request should be held open. Running it here
 * means the user can close the tab and come back, and that a proxy timeout does
 * not destroy work already paid for.
 *
 * The stages reported are the same ones the pipeline emits, written to the
 * durable `jobs` row *and* the `research_sessions` row, so a reconnecting client
 * sees exactly where the worker is.
 */
import { eq } from 'drizzle-orm';
import { loadRegistry, recordUsage, selectableModels, type RegisteredModel } from '@reklu/ai';
import { createArtifact } from '@reklu/artifacts';
import {
  db,
  plans,
  researchCitations,
  researchSessions,
  researchSources,
  subscriptions,
  type PlanLimits,
} from '@reklu/database';
import type { JobContext } from '@reklu/queue';
import {
  createWebAdapter,
  createWorkspaceAdapter,
  runResearch,
  ResearchCancelledError,
} from '@reklu/research';

export async function deepResearchHandler(
  context: JobContext<'deep_research'>,
): Promise<{ sessionId: string; sourcesUsed: number; artifactId: string | null }> {
  const { researchSessionId, workspaceId, userId, query, mode, projectId } = context.payload;
  const startedAt = Date.now();

  const registry = await loadRegistry();
  const [planRow] = await db
    .select({ limits: plans.limits, periodStart: subscriptions.currentPeriodStart })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  const allowed = selectableModels(registry, planRow?.limits as PlanLimits | undefined);
  if (allowed.length === 0) {
    throw new Error('No AI provider is configured; deep research cannot run.');
  }

  const model: RegisteredModel =
    allowed.find((m) => m.bestFor.includes('research')) ??
    allowed.find((m) => m.bestFor.includes('reasoning')) ??
    allowed[0]!;

  const adapters = [
    createWebAdapter(),
    createWorkspaceAdapter({ workspaceId, projectId: projectId ?? null }),
  ].filter((adapter) => adapter.isConfigured());

  try {
    const outcome = await runResearch({
      query,
      mode,
      model,
      adapters,

      // Every stage lands in both places so progress survives a reconnect.
      report: async (stage, detail) => {
        await context.reportStage(stage, detail);
        await db
          .update(researchSessions)
          .set({ stage, stageDetail: detail ?? null })
          .where(eq(researchSessions.id, researchSessionId));
      },

      // Cooperative cancellation between stages, so a cancelled run stops
      // spending on provider calls rather than running to completion.
      isCancelled: async () => {
        try {
          await context.throwIfCancelled();
          return false;
        } catch {
          return true;
        }
      },
    });

    // ---- Persist sources, failures included --------------------------------
    const sourceIdByIndex = new Map<number, string>();
    for (const [position, source] of outcome.sources.entries()) {
      const [row] = await db
        .insert(researchSources)
        .values({
          researchSessionId,
          workspaceId,
          type: source.kind,
          url: source.url,
          title: source.title,
          domain: source.domain,
          snippet: source.snippet,
          extractedContent: source.content?.slice(0, 50_000) ?? null,
          fetchError: source.fetchError,
          httpStatus: source.httpStatus,
          retrievedAt: source.retrievedAt,
          publishedAt: source.publishedAt,
          relevanceScore: source.relevanceScore,
          corroborationScore: source.corroborationScore,
          foundByQuery: source.foundByQuery,
          citationIndex: source.citationIndex,
        })
        .returning({ id: researchSources.id });
      if (row) sourceIdByIndex.set(position + 1, row.id);
    }

    for (const citation of outcome.citations) {
      const sourceId = sourceIdByIndex.get(citation.sourceIndex);
      if (!sourceId) continue;
      await db.insert(researchCitations).values({
        researchSessionId,
        sourceId,
        workspaceId,
        claim: citation.claim,
        supportingPassage: citation.passage || null,
        citationIndex: citation.sourceIndex,
      });
    }

    let artifactId: string | null = null;
    if (outcome.report.trim().length > 0) {
      const { artifact } = await createArtifact({
        workspaceId,
        projectId: projectId ?? null,
        userId,
        type: 'research_report',
        title: query.slice(0, 80),
        contentText: outcome.report,
        modelKey: model.key,
        sourceResearchId: researchSessionId,
      });
      artifactId = artifact.id;
    }

    await db
      .update(researchSessions)
      .set({
        stage: 'completed',
        plan: outcome.plan as unknown as Record<string, unknown>,
        queries: [...outcome.queries],
        report: outcome.report,
        answer: outcome.answer,
        sourcesDiscovered: outcome.sourcesDiscovered,
        sourcesFetched: outcome.sourcesFetched,
        sourcesUsed: outcome.sourcesUsed,
        sourcesFailed: outcome.sourcesFailed,
        artifactId,
        completedAt: new Date(),
      })
      .where(eq(researchSessions.id, researchSessionId));

    await recordUsage({
      workspaceId,
      userId,
      projectId: projectId ?? null,
      model,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 },
      kind: 'research',
      operation: `Deep Research`,
      autoRouted: true,
      latencyMs: Date.now() - startedAt,
      jobId: context.jobId,
      periodStart: planRow?.periodStart ?? new Date(),
    });

    context.log.info('Deep research complete', {
      researchSessionId,
      sourcesUsed: outcome.sourcesUsed,
      fabricatedRemoved: outcome.fabricatedCitationsRemoved,
    });

    return { sessionId: researchSessionId, sourcesUsed: outcome.sourcesUsed, artifactId };
  } catch (error) {
    const cancelled = error instanceof ResearchCancelledError;
    await db
      .update(researchSessions)
      .set({
        stage: cancelled ? 'cancelled' : 'failed',
        errorMessage: cancelled
          ? 'Cancelled.'
          : error instanceof Error
            ? error.message
            : 'Research failed.',
        ...(cancelled ? { cancelledAt: new Date() } : {}),
      })
      .where(eq(researchSessions.id, researchSessionId));
    throw error;
  }
}
