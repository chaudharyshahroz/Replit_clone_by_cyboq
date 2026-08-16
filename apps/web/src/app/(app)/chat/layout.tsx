import { ThreadList } from '@/components/chat/thread-list';
import { getAppContext } from '@/lib/auth-context';
import { listConversations } from '@/lib/conversations';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await getAppContext();
  const threads = await listConversations(user, workspace.workspaceId);

  return (
    <div className="flex h-full">
      {/* Hidden on narrow screens — the thread list is a desktop affordance. */}
      <div className="hidden lg:block">
        <ThreadList threads={threads} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
