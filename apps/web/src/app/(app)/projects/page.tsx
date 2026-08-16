import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, FileText, FolderPlus, MessageSquare, Brain } from 'lucide-react';
import { listProjects } from '@reklu/projects';
import { getAppContext } from '@/lib/auth-context';
import { NewProjectDialog } from './new-project';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const { user, workspace } = await getAppContext();
  const projects = await listProjects(workspace.workspaceId, user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl text-text">Projects</h1>
          <p className="mt-2 max-w-xl text-pretty text-text-secondary">
            A project keeps your chats, files, research and builds together — and remembers the
            context so you never have to re-explain it.
          </p>
        </div>
        <NewProjectDialog />
      </header>

      {projects.length === 0 ? (
        // Spec §90 — say what a project is for, not just "nothing here".
        <div className="mt-14 rounded-xl border border-border bg-surface/40 p-12 text-center">
          <FolderPlus className="mx-auto h-6 w-6 text-text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-text">No projects yet</p>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-text-secondary">
            Create a project to keep your chats, files, research and builds together. Reklu
            carries the context forward across all of them.
          </p>
          <div className="mt-6 flex justify-center">
            <NewProjectDialog />
          </div>
        </div>
      ) : (
        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {projects.map(({ project, conversationCount, fileCount, artifactCount, memoryCount }) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block h-full rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong hover:bg-surface"
              >
                <h2 className="truncate text-sm font-medium text-text">{project.name}</h2>
                {project.description ? (
                  <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">
                    {project.description}
                  </p>
                ) : null}

                <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-text-muted">
                  <div className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Chats</dt>
                    <dd>{conversationCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Files</dt>
                    <dd>{fileCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <Boxes className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Artifacts</dt>
                    <dd>{artifactCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <Brain className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Memories</dt>
                    <dd>{memoryCount}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
