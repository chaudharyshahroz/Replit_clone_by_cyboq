import { Sidebar } from '@/components/app/sidebar';
import { getAppContext } from '@/lib/auth-context';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await getAppContext();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop is the priority workspace (spec §7); the sidebar collapses out
          of the way below `md` rather than being compressed. */}
      <div className="hidden md:block">
        <Sidebar
          workspaceName={workspace.workspaceName}
          userName={user.name ?? 'Account'}
          userEmail={user.email}
        />
      </div>

      <main id="main" className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
