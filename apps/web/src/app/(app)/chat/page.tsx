import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { loadRegistry, selectableModels, shouldUseDevelopmentMock } from '@reklu/ai';
import { db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { ChatView, type SelectableModel } from '@/components/chat/chat-view';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Chat' };
export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const { workspace } = await getAppContext();

  const [registry, planRow] = await Promise.all([
    loadRegistry(),
    db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
  ]);

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
      initialMessages={[]}
      devMockActive={shouldUseDevelopmentMock()}
    />
  );
}
