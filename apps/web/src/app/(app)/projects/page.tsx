import type { Metadata } from 'next';
import { listProjects } from '@reklu/projects';
import { NewProjectButton } from '@/components/projects/new-project';
import { ProjectBrowser } from '@/components/projects/project-browser';
import { getAppContext } from '@/lib/auth-context';

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
        {projects.length > 0 ? <NewProjectButton /> : null}
      </header>

      <ProjectBrowser
        projects={projects.map(
          ({ project, conversationCount, fileCount, artifactCount, memoryCount }) => ({
            id: project.id,
            name: project.name,
            description: project.description,
            conversationCount,
            fileCount,
            artifactCount,
            memoryCount,
          }),
        )}
      />
    </div>
  );
}
