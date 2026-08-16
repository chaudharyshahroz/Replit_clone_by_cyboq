import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Boxes, Brain, FileText, MessageSquare } from 'lucide-react';
import { requireProject } from '@reklu/auth';
import { listArtifacts } from '@reklu/artifacts';
import { listMemories } from '@reklu/projects';
import { conversations, db, files } from '@reklu/database';
import { getAppContext } from '@/lib/auth-context';
import { InstructionsPanel } from './instructions-panel';
import { MemoryPanel } from './memory-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { user } = await getAppContext();
  const { projectId } = await params;
  try {
    const project = await requireProject(user, projectId);
    return { title: project.name };
  } catch {
    return { title: 'Project' };
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { user, workspace } = await getAppContext();
  const { projectId } = await params;

  // requireProject enforces both workspace membership and project visibility.
  let project;
  try {
    project = await requireProject(user, projectId);
  } catch {
    notFound();
  }

  const [memories, projectFiles, projectArtifacts, projectChats] = await Promise.all([
    listMemories(projectId, workspace.workspaceId, { includeUnapproved: true }),
    db
      .select({
        id: files.id,
        filename: files.filename,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
        status: files.status,
        statusDetail: files.statusDetail,
      })
      .from(files)
      .where(and(eq(files.projectId, projectId), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt)),
    listArtifacts(workspace.workspaceId, { projectId }),
    db
      .select({ id: conversations.id, title: conversations.title, lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), isNull(conversations.deletedAt)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(10),
  ]);

  const pendingCount = memories.filter((m) => m.approvedAt === null).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <Link href="/projects" className="rounded text-sm text-text-muted hover:text-text">
          ← Projects
        </Link>
        <h1 className="display mt-3 text-3xl text-text">{project.name}</h1>
        {project.description ? (
          <p className="mt-2 text-pretty text-text-secondary">{project.description}</p>
        ) : null}

        <dl className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-muted">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
            <dt className="sr-only">Chats</dt>
            <dd>{projectChats.length} chats</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            <dt className="sr-only">Files</dt>
            <dd>{projectFiles.length} files</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Boxes className="h-3.5 w-3.5" strokeWidth={1.75} />
            <dt className="sr-only">Artifacts</dt>
            <dd>{projectArtifacts.length} artifacts</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
            <dt className="sr-only">Memories</dt>
            <dd>
              {memories.length - pendingCount} memories
              {pendingCount > 0 ? (
                <span className="ml-1 text-warning">({pendingCount} to review)</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-12">
        <InstructionsPanel projectId={projectId} instructions={project.instructions ?? ''} />
      </section>

      <section className="mt-12">
        <MemoryPanel projectId={projectId} memories={memories} />
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">Files</h2>
        {projectFiles.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
            No files yet. Attach files in a chat inside this project and they become project
            knowledge.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {projectFiles.map((file) => (
              <li key={file.id} className="flex items-center gap-3 bg-surface/40 px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{file.filename}</span>
                  {file.status !== 'ready' && file.statusDetail ? (
                    <span className="block truncate text-xs text-warning">{file.statusDetail}</span>
                  ) : (
                    <span className="block text-xs text-text-muted">{file.contentType}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {(file.sizeBytes / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">Artifacts</h2>
        {projectArtifacts.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
            Documents, presentations, images and generated apps created in this project appear
            here, with full version history.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {projectArtifacts.map((artifact) => (
              <li key={artifact.id}>
                <Link
                  href={`/artifacts/${artifact.id}`}
                  className="flex items-center gap-3 bg-surface/40 px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <Boxes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{artifact.title}</span>
                    <span className="block text-xs text-text-muted">
                      {artifact.type.replace(/_/g, ' ')} · v{artifact.versionCount}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {projectChats.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium text-text">Chats</h2>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {projectChats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/chat/${chat.id}`}
                  className="block truncate bg-surface/40 px-4 py-3 text-sm text-text transition-colors hover:bg-surface-hover"
                >
                  {chat.title ?? 'Untitled chat'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
