/**
 * Compare Mode (spec §13).
 *
 * Fans one prompt out to 2–4 models and multiplexes their streams onto a single
 * SSE connection, each event tagged with its `modelKey`.
 *
 * Two decisions worth naming:
 *
 *  - Models run **concurrently**, because sequential fan-out would make the
 *    slowest model the latency of the whole comparison.
 *  - One model failing does not fail the comparison. Its column reports the
 *    error while the others continue — spec §88's partial-success rule.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkQuota,
  findModel,
  getProvider,
  loadRegistry,
  recordUsage,
  selectableModels,
  type ModelMessage,
  type RegisteredModel,
  type TokenUsage,
} from '@reklu/ai';
import { defaultWorkspaceFor, requireWorkspace } from '@reklu/auth';
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
export const dynamic = 'force-dynamic';

const MIN_MODELS = 2;
const MAX_MODELS = 4;

const BodySchema = z.object({
  message: z.string().trim().min(1).max(100_000),
  modelKeys: z.array(z.string()).min(MIN_MODELS).max(MAX_MODELS),
  conversationId: z.string().optional(),
});

/** Events carry `modelKey` so the client can route each delta to its column. */
type CompareEvent =
  | { type: 'start'; modelKey: string }
  | { type: 'text-delta'; modelKey: string; text: string }
  | { type: 'finish'; modelKey: string; usage: TokenUsage }
  | { type: 'error'; modelKey: string; message: string; retryable: boolean }
  | { type: 'all-finished'; compareGroupId: string; conversationId: string };

export async function POST(request: Request): Promise<Response> {
  const requestId = newId('aiRequest');
  const log = logger.child({ requestId, route: 'POST /api/chat/compare' });

  try {
    const session = await getSession();
    if (!session) throw errors.unauthenticated();
    const user = session.user;

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw errors.validation(
        `Compare requires between ${MIN_MODELS} and ${MAX_MODELS} models.`,
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const body = parsed.data;

    // Duplicate selections would produce two identical columns.
    const requested = [...new Set(body.modelKeys)];
    if (requested.length < MIN_MODELS) {
      throw errors.validation('Select at least two different models to compare.');
    }

    let conversation = body.conversationId
      ? (
          await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, body.conversationId))
            .limit(1)
        )[0]
      : undefined;

    if (body.conversationId && (!conversation || conversation.userId !== user.id)) {
      throw errors.notFound('Conversation');
    }

    const workspaceId = conversation?.workspaceId ?? (await requireDefaultWorkspace(user.id));
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

    const registry = await loadRegistry();
    const limits = await planLimitsFor(access.workspaceId);
    const allowed = selectableModels(registry, limits);

    const models = requested.map((key) => {
      const model = findModel(allowed, key);
      if (!model) {
        throw errors.forbidden(
          `Model ${key} unavailable to workspace ${access.workspaceId}`,
          `The model "${key}" is not available on your plan.`,
        );
      }
      return model;
    });

    // Persist the shared user turn once; all columns answer the same prompt.
    if (!conversation) {
      const [created] = await db
        .insert(conversations)
        .values({
          workspaceId: access.workspaceId,
          userId: user.id,
          mode: 'compare',
          title: body.message.slice(0, 60),
          compareModelKeys: models.map((m) => m.key),
          lastMessageAt: new Date(),
        })
        .returning();
      conversation = created!;
    }

    const conversationId = conversation.id;
    const baseSequence = conversation.messageCount;
    const compareGroupId = newId('message');

    await db.insert(messagesTable).values({
      conversationId,
      workspaceId: access.workspaceId,
      role: 'user',
      content: [{ type: 'text', text: body.message }],
      contentText: body.message,
      sequence: baseSequence,
    });

    const modelMessages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: body.message }] },
    ];
    const periodStart = quota?.periodStart ?? new Date();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: CompareEvent) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        // One task per model, all racing concurrently.
        await Promise.all(
          models.map(async (model, index) => {
            const started = Date.now();
            let text = '';
            let usage: TokenUsage = {
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              cachedInputTokens: 0,
            };
            let status: 'succeeded' | 'failed' = 'succeeded';
            let errorCode: string | null = null;

            try {
              const provider = getProvider(model.providerKey);
              if (!provider) throw errors.providerUnavailable(model.providerKey, model.key);

              send({ type: 'start', modelKey: model.key });

              for await (const event of provider.stream({
                modelIdentifier: model.modelIdentifier,
                messages: modelMessages,
                maxOutputTokens: Math.min(model.maxOutputTokens, 4_000),
                signal: request.signal,
              })) {
                if (event.type === 'text-delta') {
                  text += event.text;
                  send({ type: 'text-delta', modelKey: model.key, text: event.text });
                } else if (event.type === 'finish') {
                  usage = event.usage;
                }
              }

              // Each column is its own assistant message, linked by group id so
              // the UI can lay them out side by side and history can replay it.
              await db.insert(messagesTable).values({
                conversationId,
                workspaceId: access.workspaceId,
                role: 'assistant',
                content: [{ type: 'text', text }],
                contentText: text,
                modelKey: model.key,
                compareGroupId,
                sequence: baseSequence + 1 + index,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              });

              send({ type: 'finish', modelKey: model.key, usage });
            } catch (error) {
              // Contained per column: one failure must not abort the others.
              const rekluError = toRekluError(error);
              status = 'failed';
              errorCode = rekluError.code;
              log.error('Compare column failed', { error, modelKey: model.key });
              send({
                type: 'error',
                modelKey: model.key,
                message: rekluError.userMessage,
                retryable: rekluError.retryable,
              });
            } finally {
              await recordUsage({
                workspaceId: access.workspaceId,
                userId: user.id,
                conversationId,
                model,
                usage,
                kind: 'chat',
                operation: 'Compare',
                autoRouted: false,
                latencyMs: Date.now() - started,
                status,
                errorCode,
                requestId,
                periodStart,
              });
            }
          }),
        );

        await db
          .update(conversations)
          .set({
            lastMessageAt: new Date(),
            messageCount: baseSequence + 1 + models.length,
            compareModelKeys: models.map((m) => m.key),
          })
          .where(eq(conversations.id, conversationId));

        send({ type: 'all-finished', compareGroupId, conversationId });
        closed = true;
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Conversation-Id': conversationId,
      },
    });
  } catch (error) {
    const rekluError = toRekluError(error);
    if (!isRekluError(error)) log.error('Unhandled compare error', { error });
    return NextResponse.json(rekluError.toClientJSON(), { status: rekluError.status });
  }
}

async function requireDefaultWorkspace(userId: string): Promise<string> {
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
