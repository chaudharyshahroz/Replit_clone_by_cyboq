import { listProjects } from '@reklu/projects';
import { Sidebar } from '@/components/app/sidebar';
import { autoReconcile } from '@reklu/billing';
import { getAppContext } from '@/lib/auth-context';
import { listConversations } from '@/lib/conversations';
import { purchasablePlans } from '@/lib/purchasable-plans';
import { db, plans as plansTable, subscriptions } from '@reklu/database';
import { eq } from 'drizzle-orm';

/**
 * History and projects load here rather than per-page, because the sidebar
 * shows them on every screen. Forcing dynamic rendering is the cost of a
 * sidebar that reflects what the user actually has.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await getAppContext();

  /*
   * A purchase applies itself.
   *
   * Before this, a customer who paid had to press a button on the billing page
   * to be given what they had bought — which is the same as not being upgraded,
   * because nobody does that. Running here means the plan lands on whatever
   * page they happen to open next.
   *
   * Awaited before the plan is read below, so the sidebar shows the plan they
   * just bought rather than the one they had a second ago. It returns on a
   * single indexed query unless a checkout from the last hour is still
   * unresolved, so the ordinary page load pays almost nothing for it.
   */
  await autoReconcile(workspace.workspaceId);

  const [threads, projects, sellable, current] = await Promise.all([
    listConversations(user, workspace.workspaceId),
    listProjects(workspace.workspaceId, user.id),
    purchasablePlans(),
    db
      .select({ key: plansTable.key })
      .from(subscriptions)
      .innerJoin(plansTable, eq(subscriptions.planId, plansTable.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop is the priority workspace (spec §7); the sidebar collapses out
          of the way below `md` rather than being compressed. */}
      <div className="hidden md:block">
        <Sidebar
          workspaceName={workspace.workspaceName}
          userName={user.name ?? 'Account'}
          userEmail={user.email}
          threads={threads}
          projects={projects.map(({ project }) => ({ id: project.id, name: project.name }))}
          plans={sellable}
          currentPlanKey={current[0]?.key ?? null}
        />
      </div>

      <main id="main" className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
