/**
 * Chat no longer carries its own thread list: history lives in the workspace
 * sidebar, where it is reachable from every screen rather than only from here.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-full">{children}</div>;
}
