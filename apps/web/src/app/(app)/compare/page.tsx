import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { loadRegistry, selectableModels } from '@reklu/ai';
import { db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import type { SelectableModel } from '@/components/chat/chat-view';
import { CompareView } from '@/components/chat/compare-view';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Compare' };
export const dynamic = 'force-dynamic';

export default async function ComparePage() {
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

  // Comparing needs at least two selectable models. Say so plainly rather than
  // rendering a picker that cannot reach a valid selection (spec §137).
  if (models.length < 2) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="display text-2xl text-text">Compare needs two models</h1>
        <p className="mt-3 text-pretty leading-relaxed text-text-secondary">
          This instance has {models.length === 0 ? 'no' : 'only one'} model available. Configure a
          second AI provider key in <code className="text-text">.env</code> to compare answers
          side by side.
        </p>
      </div>
    );
  }

  return <CompareView models={models} />;
}
