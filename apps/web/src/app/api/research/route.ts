/**
 * Research endpoint.
 *
 * Streams **real** stage transitions as the pipeline enters them (spec §25).
 * Sources are persisted as they are retrieved — including failures — so the
 * sources panel can report "14 of 18 retrieved" honestly.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkQuota,
  findModel,
  loadRegistry,
  recordUsage,
  selectableModels,
  type RegisteredModel,
} from '@reklu/ai';
import { createArtifact } from '@reklu/artifacts';
import { defaultWorkspaceFor, requireWorkspace } from '@reklu/auth';
import {
  db,
  plans,
  researchCitations,
  researchSessions,
  researchSources,
  subscriptions,
  type PlanLimits,
} from '@reklu/database';
import {
  createWebAdapter,
  createWorkspaceAdapter,
  runResearch,
  type ResearchStage,
  linkCitations,
} from '@reklu/research';
import { enqueue } from '@reklu/queue';
import { errors, isRekluError, logger, newId, toRekluError } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  query: z.string().trim().min(3, 'Ask a research question.').max(2_000),
  mode: z.enum(['quick', 'research', 'deep']).default('research'),
  projectId: z.string().optional(),
});

type ResearchEvent =
  | { type: 'start'; sessionId: string; modelKey: string; sources: string[] }
  | { type: 'stage'; stage: ResearchStage; detail?: string }
  | { type: 'sources'; discovered: number; fetched: number; failed: number }
  | {
      type: 'done';
      report: string;
      answer: string | null;
      sourcesUsed: number;
      sourcesFailed: number;
      fabricatedRemoved: number;
      artifactId: string | null;
      /**
       * The sources the report actually cites, in citation order.
       *
       * Sent so the reader can open what a claim rests on. Without them the
       * client only had counts — "14 sources used" with no way to check any of
       * them, which is the opposite of the point.
       */
      citedSources: readonly {
        index: number;
        url: string;
        title: string;
        domain: string | null;
      }[];
    }
  | { type: 'error'; code: string; message: string; retryable: boolean };

export async function POST(request: Request): Promise<Response> {
  const requestId = newId('aiRequest');
  const log = logger.child({ requestId, route: 'POST /api/research' });

  try {
    const session = await getSession();
    if (!session) throw errors.unauthenticated();
    const user = session.user;

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw errors.validation(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const body = parsed.data;

    const workspaceId = (await defaultWorkspaceFor(user.id))?.id;
    if (!workspaceId) throw errors.internal(`User ${user.id} has no workspace`);
    const access = await requireWorkspace(user, workspaceId);

    const quota = await checkQuota(access.workspaceId);
    if (quota?.exceeded) {
      throw errors.quotaExceeded({
        resource: 'AI units',
        used: Math.round(quota.used),
        limit: quota.limit ?? 0,
        resetsAt: quota.periodEnd,
      });
    }

    // ---- Model ------------------------------------------------------------
    const registry = await loadRegistry();
    const [planRow] = await db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, access.workspaceId))
      .limit(1);

    const limits = planRow?.limits as PlanLimits | undefined;
    const allowed = selectableModels(registry, limits);
    if (allowed.length === 0) {
      throw errors.notConfigured({
        feature: 'Research',
        requiredEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
        docsPath: '/settings',
      });
    }

    // Research benefits from a strong model; prefer one tagged for it.
    const model: RegisteredModel =
      allowed.find((m) => m.bestFor.includes('research')) ??
      allowed.find((m) => m.bestFor.includes('reasoning')) ??
      allowed[0]!;

    // ---- Sources -----------------------------------------------------------
    const webAdapter = createWebAdapter();
    const workspaceAdapter = createWorkspaceAdapter({
      workspaceId: access.workspaceId,
      projectId: body.projectId ?? null,
    });

    const adapters = [webAdapter, workspaceAdapter].filter((adapter) => adapter.isConfigured());
    const activeKinds = adapters.map((adapter) => adapter.kind);

    // ---- Session record ----------------------------------------------------
    const [created] = await db
      .insert(researchSessions)
      .values({
        workspaceId: access.workspaceId,
        projectId: body.projectId ?? null,
        userId: user.id,
        query: body.query,
        mode: body.mode,
        stage: 'queued',
      })
      .returning({ id: researchSessions.id });

    const sessionId = created!.id;
    const periodStart = quota?.periodStart ?? new Date();

    // Deep mode runs two rounds over up to RESEARCH_MAX_SOURCES sources, which
    // can outlast a request. Hand it to the worker so the user can close the
    // tab, and return immediately with the session to poll.
    if (body.mode === 'deep') {
      const jobId = await enqueue({
        kind: 'deep_research',
        payload: {
          researchSessionId: sessionId,
          workspaceId: access.workspaceId,
          userId: user.id,
          query: body.query,
          mode: 'deep',
          projectId: body.projectId ?? null,
        },
        workspaceId: access.workspaceId,
        userId: user.id,
        projectId: body.projectId ?? null,
        resourceType: 'research_session',
        resourceId: sessionId,
      });

      return NextResponse.json(
        { sessionId, jobId, queued: true, href: `/research/${sessionId}` },
        { status: 202 },
      );
    }
    const encoder = new TextEncoder();
    const startedAt = Date.now();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ResearchEvent) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

        send({ type: 'start', sessionId, modelKey: model.key, sources: activeKinds });

        try {
          const outcome = await runResearch({
            query: body.query,
            mode: body.mode,
            model,
            adapters,
            signal: request.signal,
            // Progress is written to the durable row *and* streamed, so a
            // reconnecting client sees the same stage the worker is in.
            report: async (stage, detail) => {
              await db
                .update(researchSessions)
                .set({ stage, stageDetail: detail ?? null })
                .where(eq(researchSessions.id, sessionId));
              send({ type: 'stage', stage, ...(detail ? { detail } : {}) });
            },
          });

          send({
            type: 'sources',
            discovered: outcome.sourcesDiscovered,
            fetched: outcome.sourcesFetched,
            failed: outcome.sourcesFailed,
          });

          // ---- Persist sources, including failures ---------------------------
          const sourceIdByIndex = new Map<number, string>();
          for (const [position, source] of outcome.sources.entries()) {
            const [row] = await db
              .insert(researchSources)
              .values({
                researchSessionId: sessionId,
                workspaceId: access.workspaceId,
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

          // ---- Persist citations ---------------------------------------------
          // Only citations whose source actually exists reach the database —
          // fabricated markers were already stripped by the pipeline.
          for (const citation of outcome.citations) {
            const sourceId = sourceIdByIndex.get(citation.sourceIndex);
            if (!sourceId) continue;
            await db.insert(researchCitations).values({
              researchSessionId: sessionId,
              sourceId,
              workspaceId: access.workspaceId,
              claim: citation.claim,
              supportingPassage: citation.passage,
              citationIndex: citation.sourceIndex,
            });
          }

          // ---- Report artifact (spec §26) ------------------------------------
          let artifactId: string | null = null;
          if (outcome.report.trim().length > 0 && body.mode !== 'quick') {
            const { artifact } = await createArtifact({
              workspaceId: access.workspaceId,
              projectId: body.projectId ?? null,
              userId: user.id,
              type: 'research_report',
              title: body.query.slice(0, 80),
              contentText: outcome.report,
              modelKey: model.key,
              sourceResearchId: sessionId,
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
            .where(eq(researchSessions.id, sessionId));

          /*
           * Markers are linked here rather than in the browser: the research
           * package is server-only, and doing it once on the way out means
           * every surface that renders a report gets clickable citations —
           * including chat, which had inert markers because the transform
           * lived in the research page's own component.
           */
          const citedSources = outcome.sources
            .filter((source) => source.citationIndex !== null && source.url)
            .sort((a, b) => (a.citationIndex ?? 0) - (b.citationIndex ?? 0))
            .map((source) => ({
              index: source.citationIndex!,
              url: source.url!,
              title: source.title,
              domain: source.domain,
            }));

          send({
            type: 'done',
            report: linkCitations(outcome.report, citedSources),
            answer: outcome.answer,
            sourcesUsed: outcome.sourcesUsed,
            sourcesFailed: outcome.sourcesFailed,
            fabricatedRemoved: outcome.fabricatedCitationsRemoved,
            artifactId,
            /*
             * Only sources that earned a citation index — the ones the report
             * refers to. Sources that were read and not used would pad the
             * list and imply support that was never claimed.
             */
            citedSources,
          });
        } catch (error) {
          const rekluError = toRekluError(error);
          log.error('Research failed', { error, sessionId });
          await db
            .update(researchSessions)
            .set({
              stage: 'failed',
              errorCode: rekluError.code,
              errorMessage: rekluError.userMessage,
            })
            .where(eq(researchSessions.id, sessionId));

          send({
            type: 'error',
            code: rekluError.code,
            message: rekluError.userMessage,
            retryable: rekluError.retryable,
          });
        } finally {
          await recordUsage({
            workspaceId: access.workspaceId,
            userId: user.id,
            projectId: body.projectId ?? null,
            model,
            usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 },
            kind: 'research',
            operation: `Research (${body.mode})`,
            autoRouted: true,
            latencyMs: Date.now() - startedAt,
            requestId,
            periodStart,
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Research-Session-Id': sessionId,
      },
    });
  } catch (error) {
    const rekluError = toRekluError(error);
    if (!isRekluError(error)) log.error('Unhandled research error', { error });
    return NextResponse.json(rekluError.toClientJSON(), { status: rekluError.status });
  }
}
