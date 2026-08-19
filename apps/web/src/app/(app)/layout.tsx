import { listProjects } from '@reklu/projects';
import { Sidebar } from '@/components/app/sidebar';
import { getAppContext } from '@/lib/auth-context';
import { listConversations } from '@/lib/conversations';

/**
 * History and projects load here rather than per-page, because the sidebar
 * shows them on every screen. Forcing dynamic rendering is the cost of a
 * sidebar that reflects what the user actually has.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await getAppContext();

  const [threads, projects] = await Promise.all([
    listConversations(user, workspace.workspaceId),
    listProjects(workspace.workspaceId, user.id),
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
        />
      </div>

      <main id="main" className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
