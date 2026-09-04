import type { Metadata } from 'next';
import type { SelectableModel } from '@/components/chat/chat-view';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import {
  currentPreview,
  listCheckpoints,
  loadTree,
  DesignEngineV4Schema,
  type BuildBrief,
} from '@reklu/build';
import { loadRegistry, selectableModels } from '@reklu/ai';
import { buildProjects, db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { sandboxStatus } from '@reklu/sandbox';
import { BuildWorkspace } from '@/components/build/build-workspace';
import { getAppContext } from '@/lib/auth-context';
import { startPreviewAction } from '../actions';
import { BriefPanel } from './brief-panel';
import { previewFramingProblem } from '@/lib/preview-framing';

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
    .where(and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)))
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

  /*
   * The composer offers what this plan may actually use. A picker listing a
   * model the workspace cannot reach is a control that fails after it is used,
   * which is worse than one that was never offered.
   */
  const [registry, planRow] = await Promise.all([
    loadRegistry(),
    db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
  ]);

  const models: SelectableModel[] = selectableModels(
    registry,
    planRow[0]?.limits as PlanLimits | undefined,
  ).map((model) => ({
    key: model.key,
    displayName: model.displayName,
    providerName: model.providerName,
    description: model.description,
    speed: model.speed,
    costTier: model.costTier,
    isDevelopmentMock: model.isDevelopmentMock,
    bestFor: model.bestFor,
  }));

  const [files, checkpoints, preview] = await Promise.all([
    loadTree(buildId, workspace.workspaceId),
    listCheckpoints(buildId, workspace.workspaceId),
    currentPreview(buildId, workspace.workspaceId),
  ]);

  const status = sandboxStatus();
  /* Said here, where the blank frame appears, rather than only in a log. */
  const framingProblem = previewFramingProblem();
  const latest = checkpoints[0];
  const analysis = (project.codebaseAnalysis ?? {}) as Record<string, unknown>;
  const engine = DesignEngineV4Schema.safeParse(analysis.designEngineV4);
  const quality = (analysis.designQuality ?? {}) as Record<string, unknown>;
  const qualityCurrent = quality.versionId === project.currentVersionId;
  const qualityLabel =
    qualityCurrent && quality.status === 'approved'
      ? 'Approved'
      : qualityCurrent && quality.status === 'needs_revision'
        ? 'Needs revision'
        : 'Verification pending';
  const qualityReasons = [
    ...(Array.isArray(quality.failures) ? quality.failures : []),
    ...(Array.isArray(quality.pending) ? quality.pending : []),
  ].filter((item): item is string => typeof item === 'string');

  return (
    /*
       One screen, two panes: what you are asking for on the left, what you are
       getting on the right.

       This was a vertical stack — header, brief, export, then the workspace —
       so the preview began below the fold and the thing being built was never
       visible at the same time as the conversation about it. Getting to the
       application meant leaving the page that describes it.

       This container owns its scrolling at every width, which is the only
       arrangement where the page cannot scroll past its own layout.

       Leaving that to the app shell meant two scroll containers disagreeing
       about how tall the content was: the shell scrolled, this box did not
       follow, and below it there was nothing to paint — a black band under
       everything. Whether it happened depended on which pane the pointer was
       over, because that decided which container received the wheel.

       Side by side the two panes fill one screen and each scrolls internally.
       Stacked, they flow and this box scrolls instead. Either way the shell
       never scrolls, so there is never a gap beneath.
    */
    <div
      /*
        Tells the shell to stop scrolling this route. See globals.css: the
        height arithmetic that should have made this unnecessary is the thing
        that kept being subtly wrong, so the page says what it needs instead of
        the shell inferring it.
      */
      data-fills-screen
      className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
    >
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
          {engine.success ? (
            <details className="mt-3 text-xs text-text-secondary">
              <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2">
                Design V4 · {qualityLabel}
              </summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                <p>
                  {engine.data.selection.profile} · {engine.data.product.industry}
                </p>
                <p>Preview readiness is separate from design approval.</p>
                {qualityCurrent && qualityReasons.length ? (
                  <ul className="list-disc space-y-1 pl-4">
                    {qualityReasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p>This version still needs responsive, image and interaction evidence.</p>
                )}
                {qualityCurrent && typeof quality.reviewUnavailable === 'string' ? (
                  <p>{quality.reviewUnavailable}</p>
                ) : null}
              </div>
            </details>
          ) : null}
        </header>

        {/* The pane scrolls; the panes do not scroll each other. */}
        {/*
          No scrolling here. The panel owns the pane so it can keep its composer
          pinned to the bottom while everything above it scrolls — a box that
          scrolls as a whole cannot do that.
        */}
        <div className="flex min-h-0 flex-1 flex-col">
          {project.brief ? (
            <BriefPanel
              brief={project.brief as unknown as BuildBrief}
              buildId={buildId}
              models={models}
              hasFiles={files.length > 0}
              status={project.status}
            />
          ) : null}
        </div>
      </aside>

      {/*
        A usable height when the panes are stacked, and none when they are side
        by side. Below `lg` the two panes sit one above the other and each needs
        to size to its own content — the preview would otherwise collapse to
        nothing, since a flex item with no basis in a column takes the height it
        is given.
      */}
      <div className="min-h-[32rem] min-w-0 flex-1 lg:min-h-0">
        <BuildWorkspace
          buildId={buildId}
          files={files.map((file) => ({
            path: file.path,
            content: file.content,
            language: file.language,
            ...(file.binary ? { imageBytes: file.binary.bytes } : {}),
          }))}
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
          target={project.target}
          sandboxIsolated={status.isolated && status.available}
          sandboxDetail={status.detail}
          framingProblem={framingProblem}
        />
      </div>
    </div>
  );
}
