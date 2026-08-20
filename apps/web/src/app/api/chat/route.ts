/**
 * Chat streaming endpoint.
 *
 * Order of operations is the security contract (docs/ARCHITECTURE.md §4.1):
 * authenticate → resolve workspace → check quota → validate input → resolve
 * model → stream → persist → meter. Nothing is written before authorization,
 * and the usage ledger is written even when the stream fails part-way.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  autoSelect,
  checkQuota,
  findModel,
  getProvider,
  loadRegistry,
  recordUsage,
  selectableModels,
  type ModelMessage,
  type RegisteredModel,
  type StreamEvent,
  type TokenUsage,
} from '@reklu/ai';
import { requireWorkspace } from '@reklu/auth';
import {
  conversations,
  db,
  messageAttachments,
  messages as messagesTable,
  plans,
  subscriptions,
  type PlanLimits,
} from '@reklu/database';
import { errors, isRekluError, logger, newId, slugify, toRekluError } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';
import { loadAttachments } from '@/lib/files';
import { buildAttachmentParts } from '@/lib/attachment-parts';
import { assembleProjectContext, extractMemories, touchProject } from '@reklu/projects';
import { createArtifact, detectArtifact } from '@reklu/artifacts';
import {
  buildSkillPrompt,
  recordSkillUse,
  resolveInvocation,
  stripMention,
} from '@reklu/skills';
import { executeTool, usableTools } from '@reklu/mcp';
import { createImage } from '@reklu/create';
import { generateBrief } from '@reklu/build';
import {
  createWebAdapter,
  createWorkspaceAdapter,
  linkCitations,
  runResearch,
  type StageReporter,
} from '@reklu/research';
import { buildProjects, researchSessions } from '@reklu/database';

export const runtime = 'nodejs';
// Streaming must never be cached or statically optimized.
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1, 'Message must not be empty.').max(100_000),
  /** Omit or pass "auto" to let Reklu Auto choose. */
  modelKey: z.string().optional(),
  /** Files already uploaded via /api/files/upload. */
  fileIds: z.array(z.string()).max(10).optional(),
  /** Run this turn inside a project, inheriting its instructions and memory. */
  projectId: z.string().optional(),
  /**
   * A composer tool. Omitted or "chat" is an ordinary model reply; the others
   * run that capability inside this conversation rather than sending the user
   * somewhere else, so the transcript stays in one place.
   */
  tool: z.enum(['chat', 'build', 'image', 'research']).optional(),
});

const SYSTEM_PROMPT = [
  'You are Reklu, an AI workspace where people research, create, build and take action.',
  'Be direct and concrete. Prefer specifics over generalities.',
  'When you are uncertain, say so rather than inventing detail.',
].join('\n');

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newId('aiRequest');
  const log = logger.child({ requestId, route: 'POST /api/chat' });

  try {
    // ---- 1. Authenticate -------------------------------------------------
    const session = await getSession();
    if (!session) throw errors.unauthenticated();
    const user = session.user;

    // ---- 2. Validate -----------------------------------------------------
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw errors.validation(
        parsed.error.issues.map((i) => i.message).join('; '),
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const body = parsed.data;

    // ---- 3. Resolve conversation + workspace ------------------------------
    let conversation = body.conversationId
      ? (
          await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, body.conversationId))
            .limit(1)
        )[0]
      : undefined;

    if (body.conversationId && !conversation) throw errors.notFound('Conversation');

    // Membership is proved before any row is read or written.
    const workspaceId = conversation?.workspaceId ?? (await defaultWorkspaceId(user.id));
    const access = await requireWorkspace(user, workspaceId);

    // A conversation belonging to someone else in the same workspace is not ours.
    if (conversation && conversation.userId !== user.id) {
      throw errors.notFound('Conversation');
    }

    // ---- 4. Quota ---------------------------------------------------------
    const quota = await checkQuota(access.workspaceId);
    if (quota?.exceeded) {
      throw errors.quotaExceeded({
        resource: 'AI units',
        used: Math.round(quota.used),
        limit: quota.limit ?? 0,
        resetsAt: quota.periodEnd,
      });
    }

    // ---- 5. Resolve the model --------------------------------------------
    const registry = await loadRegistry();
    const limits = await planLimitsFor(access.workspaceId);
    const allowed = selectableModels(registry, limits);

    if (allowed.length === 0) {
      throw errors.notConfigured({
        feature: 'Chat',
        requiredEnv: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
        docsPath: '/settings',
      });
    }

    const attachments = await loadAttachments(access.workspaceId, body.fileIds ?? []);
    const attachmentParts = await buildAttachmentParts(attachments);

    // Project context: instructions, approved memories, and retrieved file
    // passages, assembled within a token budget. Prepended as a *user* message
    // — project instructions are user instruction, not system authority.
    const projectId = body.projectId ?? conversation?.projectId ?? null;
    const projectContext = projectId
      ? await assembleProjectContext({
          projectId,
          workspaceId: access.workspaceId,
          query: body.message,
        })
      : undefined;

    /**
     * Skills (spec §41). A saved instruction the user chose to apply, invoked
     * with `@handle`.
     *
     * The skill block is a *user* message placed immediately before the
     * request it modifies — never a system message. Skill text is authored by
     * users, and a public skill by someone other than the person running it,
     * so it is user-level instruction and `buildSkillPrompt` says so in the
     * framing it wraps around it.
     */
    const invocation = await resolveInvocation(body.message, access.workspaceId);
    const invokedSkill = invocation.skills[0];
    const requestText = invokedSkill
      ? stripMention(body.message, invokedSkill.handle)
      : body.message;

    if (invokedSkill) {
      // Usage ordering in the library. Never worth failing a chat turn over,
      // so a bookkeeping error is logged rather than thrown.
      await recordSkillUse(invokedSkill.id, access.workspaceId).catch((error: unknown) => {
        logger.warn('Could not record skill use', { error, skillId: invokedSkill.id });
      });
    }

    const history = conversation ? await loadHistory(conversation.id) : [];
    const modelMessages: ModelMessage[] = [
      ...(projectContext?.contextBlock
        ? [
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: projectContext.contextBlock }],
            },
          ]
        : []),
      ...history,
      ...(invokedSkill
        ? [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: buildSkillPrompt(invokedSkill).text },
              ],
            },
          ]
        : []),
      {
        role: 'user',
        content: [{ type: 'text', text: requestText }, ...attachmentParts],
      },
    ];

    /**
     * MCP tools (spec §49).
     *
     * Only tools that are enabled, on a healthy server whose definitions a
     * human approved, are offered — `usableTools` filters those. That filter
     * is a courtesy, not the control: `executeTool` re-runs the full
     * permission engine on every call, so a tool that slipped through would
     * still be refused.
     *
     * A refused call returns TEXT rather than throwing. The model needs to
     * learn it was refused so it can tell the user, and a thrown error would
     * end the turn with nothing useful said.
     */
    const availableTools = await usableTools(access.workspaceId);
    const toolDefinitions = availableTools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      riskClass: tool.riskClass,
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const result = await executeTool({
          toolId: tool.id,
          workspaceId: access.workspaceId,
          userId: session.user.id,
          args,
          conversationId: conversation?.id,
        });

        if (result.status === 'succeeded') return result.output ?? '';
        if (result.status === 'pending_approval') {
          return `This tool was not run: ${result.reason} Ask the user to approve it.`;
        }
        return `This tool was not run: ${result.reason}`;
      },
    }));

    let model: RegisteredModel;
    let routingReason: string | null = null;
    const autoRouted = !body.modelKey || body.modelKey === 'auto';

    if (autoRouted) {
      const decision = autoSelect({
        messages: modelMessages,
        system: SYSTEM_PROMPT,
        candidates: allowed,
        limits,
      });
      model = decision.model;
      routingReason = decision.reason;
    } else {
      const chosen = findModel(allowed, body.modelKey!);
      if (!chosen) {
        // Deliberately not a silent substitution — spec §107 forbids switching
        // models in a way that changes what the user asked for.
        throw errors.forbidden(
          `Model ${body.modelKey} is unavailable to workspace ${access.workspaceId}`,
          'That model is not available on your plan, or is not configured on this instance.',
        );
      }
      model = chosen;
    }

    const provider = getProvider(model.providerKey);
    if (!provider) {
      throw errors.providerUnavailable(model.providerKey, model.key);
    }

    // ---- 6. Persist the user turn ----------------------------------------
    if (!conversation) {
      const [created] = await db
        .insert(conversations)
        .values({
          workspaceId: access.workspaceId,
          userId: user.id,
          projectId,
          mode: 'chat',
          // A real title is generated later; until then show the prompt itself.
          title: body.message.slice(0, 60),
          titleIsAuto: true,
          modelKey: autoRouted ? null : model.key,
          lastMessageAt: new Date(),
        })
        .returning();
      conversation = created!;
    }

    const nextSequence = conversation.messageCount;
    const [userMessage] = await db
      .insert(messagesTable)
      .values({
        conversationId: conversation.id,
        workspaceId: access.workspaceId,
        role: 'user',
        content: [{ type: 'text', text: body.message }],
        contentText: body.message,
        sequence: nextSequence,
      })
      .returning({ id: messagesTable.id });

    if (attachments.length > 0 && userMessage) {
      await db.insert(messageAttachments).values(
        attachments.map((file) => ({
          messageId: userMessage.id,
          workspaceId: access.workspaceId,
          fileId: file.id,
        })),
      );
    }

    const conversationId = conversation.id;
    const periodStart = quota?.periodStart ?? new Date();

    // ---- 7. Stream --------------------------------------------------------
    const encoder = new TextEncoder();
    const started = Date.now();
    let firstTokenAt: number | undefined;
    let text = '';
    let usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: StreamEvent) => controller.enqueue(encoder.encode(sse(event)));

        try {
          send({
            type: 'start',
            modelKey: model.key,
            ...(routingReason ? { routingReason } : {}),
          });

          /**
           * A tool runs its own capability into this conversation.
           *
           * Each delegates to the package that already implements it, so the
           * behaviour is the same one the dedicated surface gives you — the
           * only difference is that the result lands in the transcript you are
           * already reading instead of on another page.
           */
          const tool = body.tool ?? 'chat';

          if (tool === 'image') {
            send({ type: 'status', stage: 'generating', detail: 'Generating the image…' });

            const result = await createImage({
              workspaceId: access.workspaceId,
              userId: user.id,
              projectId,
              prompt: body.message,
            });

            text = `Generated **${result.title}** · ${result.detail}`;
            send({ type: 'text-delta', text });
            send({
              type: 'artifact',
              artifact: { id: result.artifactId, title: result.title, type: 'image' },
            });
          } else if (tool === 'build') {
            send({ type: 'status', stage: 'planning', detail: 'Planning the build…' });

            const { brief, usedFallback } = await generateBrief({ prompt: body.message, model });
            const buildId = newId('build');
            const name = brief.product.slice(0, 120);

            await db.insert(buildProjects).values({
              id: buildId,
              workspaceId: access.workspaceId,
              createdById: user.id,
              name,
              slug: `${slugify(brief.product)}-${buildId.slice(-6)}`,
              target: brief.target,
              status: 'briefing',
              brief: brief as unknown as Record<string, unknown>,
              framework: brief.stack[0] ?? null,
              createdBy: user.id,
            });

            if (usedFallback) log.warn('Build brief fell back to heuristics', { buildId });

            /*
             * The brief lands here; the file tree, preview and version history
             * do not, because those are a workspace rather than a message. The
             * link is how you get to them, and the conversation stays put.
             */
            text = [
              `**${name}**`,
              '',
              brief.summary ?? '',
              '',
              `Target: ${brief.target}${brief.stack.length > 0 ? ` · ${brief.stack.join(', ')}` : ''}`,
              '',
              `[Open the build workspace](/build/${buildId}) to generate the code, preview it and revise.`,
            ].join('\n');
            send({ type: 'text-delta', text });
          } else if (tool === 'research') {
            const adapters = [
              createWebAdapter(),
              createWorkspaceAdapter({
                workspaceId: access.workspaceId,
                projectId: projectId ?? null,
              }),
            ].filter((adapter) => adapter.isConfigured());

            if (adapters.length === 0) {
              throw errors.notConfigured({
                feature: 'Research',
                requiredEnv: ['TAVILY_API_KEY', 'BRAVE_API_KEY'],
                docsPath: '/settings',
              });
            }

            // Recorded like any other research run, so it appears in history
            // rather than being a private variant only chat knows about.
            const [session] = await db
              .insert(researchSessions)
              .values({
                workspaceId: access.workspaceId,
                projectId: projectId ?? null,
                userId: user.id,
                query: body.message,
                mode: 'research',
                stage: 'queued',
              })
              .returning({ id: researchSessions.id });

            const report: StageReporter = (stage, detail) => {
              send({ type: 'status', stage, ...(detail ? { detail } : {}) });
            };

            const outcome = await runResearch({
              query: body.message,
              mode: 'research',
              model,
              adapters,
              report,
              signal: request.signal,
            });

            /*
             * Reported honestly (spec §88): the count of sources that failed
             * is part of the answer, not something to quietly drop.
             */
            const retrieval =
              outcome.sourcesFailed > 0
                ? `${outcome.sourcesUsed} of ${outcome.sourcesDiscovered} sources used; ${outcome.sourcesFailed} could not be retrieved.`
                : `${outcome.sourcesUsed} sources used.`;

            const cited = outcome.sources
              .filter((source) => source.citationIndex !== null && source.url)
              .sort((a, b) => (a.citationIndex ?? 0) - (b.citationIndex ?? 0))
              .map((source) => ({
                index: source.citationIndex!,
                url: source.url!,
                title: source.title,
                domain: source.domain,
              }));

            /**
             * Chat used to end at the retrieval count: a claim of sourcing with
             * nothing to open. The markers were inert text and the sources were
             * never sent at all, because the transform lived in the research
             * page's own component rather than on the way out of the server.
             *
             * Now the answer arrives with its citations already linked and the
             * sources listed beneath it, so the two surfaces show the same
             * thing.
             */
            const sourceList =
              cited.length > 0
                ? `\n\n---\n\n**Sources**\n\n${cited
                    .map(
                      (source) =>
                        `${source.index}. [${source.title}](${source.url})${
                          source.domain ? ` — ${source.domain}` : ''
                        }`,
                    )
                    .join('\n')}`
                : '';

            const answerText = linkCitations(outcome.answer ?? outcome.report, cited);

            text = `${answerText}${sourceList}\n\n_${retrieval}_\n\n[Open the full research session](/research/${session!.id})`;
            send({ type: 'text-delta', text });
          } else {
          for await (const event of provider.stream({
            modelIdentifier: model.modelIdentifier,
            messages: modelMessages,
            system: SYSTEM_PROMPT,
            maxOutputTokens: Math.min(model.maxOutputTokens, 8_000),
            // Offered only when the model supports them and the workspace has
            // approved some; an empty list is omitted entirely rather than
            // sent as an empty object.
            ...(toolDefinitions.length > 0 && model.supportsTools
              ? { tools: toolDefinitions }
              : {}),
            signal: request.signal,
          })) {
            if (event.type === 'text-delta') {
              firstTokenAt ??= Date.now();
              text += event.text;
            }
            if (event.type === 'finish') usage = event.usage;
            send(event);
          }
          }

          // Persist the assistant turn only after a successful stream.
          const [assistant] = await db
            .insert(messagesTable)
            .values({
              conversationId,
              workspaceId: access.workspaceId,
              role: 'assistant',
              content: [{ type: 'text', text }],
              contentText: text,
              modelKey: model.key,
              sequence: nextSequence + 1,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              finishReason: 'stop',
            })
            .returning({ id: messagesTable.id });

          await db
            .update(conversations)
            .set({ lastMessageAt: new Date(), messageCount: nextSequence + 2 })
            .where(eq(conversations.id, conversationId));

          if (projectId) {
            await touchProject(projectId);

            // Propose memories from this turn. Runs after the user already has
            // their answer, lands unapproved, and never surfaces as an error —
            // it is an enhancement, not part of the request's success.
            void extractMemories({
              projectId,
              workspaceId: access.workspaceId,
              model,
              userMessage: body.message,
              assistantMessage: text,
              sourceMessageId: assistant?.id ?? '',
            }).catch((error: unknown) => {
              log.error('Memory extraction failed', { error });
            });
          }

          // Spec §19–20: a substantial reply becomes an artifact the user can
          // revise, version and export. Detection is deterministic (see
          // packages/artifacts/src/detect.ts) and conservative — most replies
          // are conversation and produce nothing.
          let artifactSummary: { id: string; title: string; type: string } | undefined;
          const candidate = detectArtifact(text);
          if (candidate) {
            try {
              const { artifact } = await createArtifact({
                workspaceId: access.workspaceId,
                projectId,
                userId: user.id,
                type: candidate.type,
                title: candidate.title,
                contentText: candidate.content,
                modelKey: model.key,
                sourceConversationId: conversationId,
                sourceMessageId: assistant?.id ?? null,
                metadata: candidate.language ? { language: candidate.language } : {},
              });
              artifactSummary = {
                id: artifact.id,
                title: artifact.title,
                type: artifact.type,
              };
              if (assistant) {
                await db
                  .update(messagesTable)
                  .set({ artifactIds: [artifact.id] })
                  .where(eq(messagesTable.id, assistant.id));
              }
              log.info('Artifact created from reply', {
                artifactId: artifact.id,
                reason: candidate.reason,
              });
            } catch (error) {
              // An artifact failing must never lose the answer the user has
              // already read.
              log.error('Could not create artifact from reply', { error });
            }
          }

          if (artifactSummary) {
            send({ type: 'artifact', artifact: artifactSummary });
          }
          send({ type: 'finish', usage, finishReason: 'stop', messageId: assistant?.id });
        } catch (error) {
          const rekluError = toRekluError(error);
          log.error('Chat stream failed', { error, modelKey: model.key });
          send({
            type: 'error',
            code: rekluError.code,
            message: rekluError.userMessage,
            retryable: rekluError.retryable,
          });
        } finally {
          // Metered whether or not the stream completed — tokens were spent
          // either way, and silently absorbing that cost hides real spend.
          await recordUsage({
            workspaceId: access.workspaceId,
            userId: user.id,
            conversationId,
            model,
            usage,
            kind: 'chat',
            operation: 'Chat',
            autoRouted,
            routingReason,
            latencyMs: Date.now() - started,
            timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : null,
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
        // Prevents proxy buffering, which otherwise defeats streaming entirely.
        'X-Accel-Buffering': 'no',
        'X-Conversation-Id': conversationId,
      },
    });
  } catch (error) {
    const rekluError = toRekluError(error);
    if (!isRekluError(error)) log.error('Unhandled chat error', { error });
    return NextResponse.json(rekluError.toClientJSON(), { status: rekluError.status });
  }
}

// ---------------------------------------------------------------------------

async function defaultWorkspaceId(userId: string): Promise<string> {
  const { defaultWorkspaceFor } = await import('@reklu/auth');
  const workspace = await defaultWorkspaceFor(userId);
  if (!workspace) throw errors.internal(`User ${userId} has no workspace`);
  return workspace.id;
}

async function planLimitsFor(workspaceId: string): Promise<PlanLimits | undefined> {
  const rows = await db
    .select({ limits: plans.limits })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return rows[0]?.limits as PlanLimits | undefined;
}

/** Most recent turns in chronological order, bounded so a long thread cannot blow the window. */
const HISTORY_TURN_LIMIT = 40;

async function loadHistory(conversationId: string): Promise<ModelMessage[]> {
  // Take the newest N by sequence, then reverse into chronological order.
  const rows = await db
    .select({ role: messagesTable.role, contentText: messagesTable.contentText })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        isNull(messagesTable.deletedAt),
      ),
    )
    .orderBy(desc(messagesTable.sequence))
    .limit(HISTORY_TURN_LIMIT);

  return rows
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: row.contentText ?? '' }],
    }));
}
