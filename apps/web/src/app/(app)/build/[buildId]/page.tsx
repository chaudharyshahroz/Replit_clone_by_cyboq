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
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <Link href="/build" className="rounded text-sm text-text-muted hover:text-text">
          ← Build
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-medium text-text">{project.name}</h1>
          <span className="rounded-md border border-border-strong px-2 py-0.5 text-[11px] text-text-secondary">
            {project.target.replace(/_/g, ' ')}
          </span>
          <span className="text-[11px] text-text-muted">{project.status}</span>
          {project.statusDetail ? (
            <span className="text-[11px] text-warning">{project.statusDetail}</span>
          ) : null}
        </div>
      </header>

      {project.brief ? (
        <div className="border-b border-border px-6 py-4">
          <BriefPanel brief={project.brief as unknown as BuildBrief} buildId={buildId} />
        </div>
      ) : null}

      <div className="border-b border-border px-6 py-4">
        <ExportPanel buildId={buildId} hasFiles={files.length > 0} />
      </div>

      <div className="min-h-0 flex-1">
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
