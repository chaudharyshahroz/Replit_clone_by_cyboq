import type { Metadata } from 'next';
import Link from 'next/link';
import { Telescope } from 'lucide-react';
import { getAppContext } from '@/lib/auth-context';
import { listResearch } from '@/lib/research';

export const metadata: Metadata = { title: 'Research history' };
export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export default async function ResearchHistoryPage() {
  const { user, workspace } = await getAppContext();
  const sessions = await listResearch(user, workspace.workspaceId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl text-text">Research history</h1>
          <p className="mt-2 text-text-secondary">Every research run, with its sources.</p>
        </div>
        <Link
          href="/research"
          className="inline-flex h-8 shrink-0 items-center rounded-md bg-accent px-3 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          New research
        </Link>
      </header>

      {sessions.length === 0 ? (
        <div className="mt-14 rounded-xl border border-border bg-surface/40 p-12 text-center">
          <Telescope className="mx-auto h-6 w-6 text-text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-text">No research yet</p>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-text-secondary">
            Ask a question and Reklu will plan the research, read sources, and cite every claim.
            Runs appear here with their full source list.
          </p>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/research/${session.id}`}
                className="block bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
              >
                <p className="truncate text-sm text-text">{session.query}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-text-muted">
                  <span>{session.mode}</span>
                  <span>{STAGE_LABEL[session.stage] ?? session.stage}</span>
                  <span>{session.sourcesUsed} cited</span>
                  {session.sourcesFailed > 0 ? (
                    <span className="text-warning">{session.sourcesFailed} unreadable</span>
                  ) : null}
                  <span>{session.createdAt.toLocaleDateString()}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
