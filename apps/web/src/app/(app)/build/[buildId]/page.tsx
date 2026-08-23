import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { currentPreview, listCheckpoints, loadTree, type BuildBrief } from '@reklu/build';
import { buildProjects, db } from '@reklu/database';
import { sandboxStatus } from '@reklu/sandbox';
import { BuildWorkspace } from '@/components/build/build-workspace';
import { getAppContext } from '@/lib/auth-context';
import { editSelectionAction, startPreviewAction } from '../actions';
import { ExportPanel } from '@/components/build/export-panel';
import { BriefPanel } from './brief-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ buildId: string }>;
}): Promise<Metadata> {
  const { workspace } = await getAppContext();
  const { buildId } = await params;
  const [project] = await db
    .select({ name: buildProjects.name })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
    )
    .limit(1);
  return { title: project?.name ?? 'Build' };
}

export default async function BuildDetailPage({
  params,
}: {
  params: Promise<{ buildId: string }>;
}) {
  const { workspace } = await getAppContext();
  const { buildId } = await params;

  const [project] = await db
    .select()
    .from(buildProjects)
    .where(
      and(
        eq(buildProjects.id, buildId),
        eq(buildProjects.workspaceId, workspace.workspaceId),
        isNull(buildProjects.deletedAt),
      ),
    )
    .limit(1);

  if (!project) notFound();

  const [files, checkpoints, preview] = await Promise.all([
    loadTree(buildId, workspace.workspaceId),
    listCheckpoints(buildId, workspace.workspaceId),
    currentPreview(buildId, workspace.workspaceId),
  ]);

  const status = sandboxStatus();
  const latest = checkpoints[0];

  return (
    /*
       One screen, two panes: what you are asking for on the left, what you are
       getting on the right.

       This was a vertical stack — header, brief, export, then the workspace —
       so the preview began below the fold and the thing being built was never
       visible at the same time as the conversation about it. Getting to the
       application meant leaving the page that describes it.
    */
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border lg:h-full lg:w-[26rem] lg:border-b-0 lg:border-r xl:w-[30rem]">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <Link href="/build" className="rounded text-sm text-text-muted hover:text-text">
            ← Build
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-medium text-text">{project.name}</h1>
            <span className="rounded-md border border-border-strong px-2 py-0.5 text-[0.6875rem] text-text-secondary">
              {project.target.replace(/_/g, ' ')}
            </span>
            <span className="text-[0.6875rem] text-text-muted">{project.status}</span>
          </div>
          {project.statusDetail ? (
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-warning">
              {project.statusDetail}
            </p>
          ) : null}
        </header>

        {/* The pane scrolls; the panes do not scroll each other. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {project.brief ? (
            <BriefPanel
              brief={project.brief as unknown as BuildBrief}
              buildId={buildId}
              hasFiles={files.length > 0}
              status={project.status}
            />
          ) : null}

          <div className="mt-6 border-t border-border pt-5">
            <ExportPanel buildId={buildId} hasFiles={files.length > 0} />
          </div>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1">
        <BuildWorkspace
          buildId={buildId}
          files={files}
          checkpoints={checkpoints.map((checkpoint) => ({
            id: checkpoint.id,
            version: checkpoint.version,
            changeSummary: checkpoint.changeSummary,
            changedPaths: checkpoint.changedPaths,
            checksPassed: checkpoint.checksPassed,
            createdAt: checkpoint.createdAt.toISOString(),
          }))}
          consoleOutput={latest?.checkOutput ?? ''}
          previewUrl={preview?.url ?? null}
          onStartPreview={startPreviewAction}
          onEditSelection={editSelectionAction}
          sandboxIsolated={status.isolated && status.available}
          sandboxDetail={status.detail}
        />
      </div>
    </div>
  );
}
