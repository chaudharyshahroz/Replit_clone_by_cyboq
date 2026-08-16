import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { loadRegistry, selectableModels, shouldUseDevelopmentMock } from '@reklu/ai';
import { db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { ChatView, type SelectableModel } from '@/components/chat/chat-view';
import { getAppContext } from '@/lib/auth-context';
import { loadConversation } from '@/lib/conversations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}): Promise<Metadata> {
  const { user, workspace } = await getAppContext();
  const { conversationId } = await params;
  const thread = await loadConversation(user, workspace.workspaceId, conversationId);
  return { title: thread?.summary.title ?? 'Chat' };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { user, workspace } = await getAppContext();
  const { conversationId } = await params;

  const [thread, registry, planRow] = await Promise.all([
    loadConversation(user, workspace.workspaceId, conversationId),
    loadRegistry(),
    db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
  ]);

  // Undefined covers both "does not exist" and "belongs to someone else".
  if (!thread) notFound();

  const limits = planRow[0]?.limits as PlanLimits | undefined;
  const models: SelectableModel[] = selectableModels(registry, limits).map((model) => ({
    key: model.key,
    displayName: model.displayName,
    providerName: model.providerName,
    description: model.description,
    speed: model.speed,
    costTier: model.costTier,
    isDevelopmentMock: model.isDevelopmentMock,
  }));

  return (
    <ChatView
      models={models}
      initialMessages={thread.messages}
      initialConversationId={thread.summary.id}
      devMockActive={shouldUseDevelopmentMock()}
    />
  );
}
