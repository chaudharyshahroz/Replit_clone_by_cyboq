import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { loadTree } from '@reklu/build';
import { buildEvents, buildProjects, db } from '@reklu/database';
import { getAppContext } from '@/lib/auth-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What a build is doing, right now.
 *
 * A route handler rather than a server action, and that distinction is the
 * whole reason this file exists. Next runs server actions from one client
 * strictly one at a time, so every request for progress queued behind the
 * generation it was asking about and arrived after it finished. The steps were
 * being written correctly throughout — nothing could read them until the work
 * was over, which is why a six-minute build showed nothing and then everything
 * at once.
 *
 * A plain GET is not queued, so this answers while the build is still running.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ buildId: string }> },
): Promise<Response> {
  const { buildId } = await params;
  const { workspace } = await getAppContext();

  const [project] = await db
    .select({ status: buildProjects.status, statusDetail: buildProjects.statusDetail })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.id, buildId), eq(buildProjects.workspaceId, workspace.workspaceId)),
    )
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: 'No such build.' }, { status: 404 });
  }

  const [files, steps] = await Promise.all([
    loadTree(buildId, workspace.workspaceId),
    db
      .select({
        id: buildEvents.id,
        kind: buildEvents.kind,
        message: buildEvents.message,
        path: buildEvents.path,
      })
      .from(buildEvents)
      .where(eq(buildEvents.buildProjectId, buildId))
      .orderBy(asc(buildEvents.createdAt))
      .limit(300),
  ]);

  return NextResponse.json(
    {
      status: project.status,
      detail: project.statusDetail,
      fileCount: files.length,
      steps,
    },
    // Never cached: the entire value of this response is that it is current.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
