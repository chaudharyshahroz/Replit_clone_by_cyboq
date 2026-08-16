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
  messages as messagesTable,
  plans,
  subscriptions,
  type PlanLimits,
} from '@reklu/database';
import { errors, isRekluError, logger, newId, toRekluError } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';

export const runtime = 'nodejs';
// Streaming must never be cached or statically optimized.
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1, 'Message must not be empty.').max(100_000),
  /** Omit or pass "auto" to let Reklu Auto choose. */
  modelKey: z.string().optional(),
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

    const history = conversation ? await loadHistory(conversation.id) : [];
    const modelMessages: ModelMessage[] = [
      ...history,
      { role: 'user', content: [{ type: 'text', text: body.message }] },
    ];

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
    await db.insert(messagesTable).values({
      conversationId: conversation.id,
      workspaceId: access.workspaceId,
      role: 'user',
      content: [{ type: 'text', text: body.message }],
      contentText: body.message,
      sequence: nextSequence,
    });

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

          for await (const event of provider.stream({
            modelIdentifier: model.modelIdentifier,
            messages: modelMessages,
            system: SYSTEM_PROMPT,
            maxOutputTokens: Math.min(model.maxOutputTokens, 8_000),
            signal: request.signal,
          })) {
            if (event.type === 'text-delta') {
              firstTokenAt ??= Date.now();
              text += event.text;
            }
            if (event.type === 'finish') usage = event.usage;
            send(event);
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
