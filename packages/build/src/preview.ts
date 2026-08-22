/**
 * Preview lifecycle (spec §34).
 *
 * Materializes a build's file tree into a sandbox, installs dependencies, and
 * starts a dev server. The resulting URL is served from a **separate origin**
 * from Reklu — same-origin would give generated code access to the session
 * cookie, which is exactly the escape the sandbox exists to prevent.
 *
 * Sandboxes are tracked as rows so they can be reaped: an idle preview is
 * billable compute doing nothing, and the worker's `reap_sandboxes` task
 * already looks for them.
 */
import { createServer } from 'node:net';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { buildProjects, db, sandboxes } from '@reklu/database';
import { sandbox, sandboxStatus, type PreviewHandle } from '@reklu/sandbox';
import { errors, logger, newId } from '@reklu/shared';
import { devCommandFor, parseManifest } from './dev-command';
import { materialize, type BuildStageReporter } from './generate';
import { loadTree } from './versions';

/** Previews live on a dedicated range, well away from Reklu's own port. */
const PORT_RANGE_START = 43_000;
const PORT_RANGE_END = 43_200;

/** Previews are reaped after this long idle. */
const PREVIEW_TTL_MS = 30 * 60 * 1000;

/** In-process handles, so a preview can be stopped without re-spawning. */
const running = new Map<string, PreviewHandle>();

/** Find a free port by asking the OS, rather than guessing and colliding. */
async function findFreePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw errors.internal('No free preview port available');
}

export interface StartPreviewResult {
  readonly url: string;
  readonly port: number;
  readonly sandboxId: string;
  readonly installed: boolean;
  readonly checksPassed: boolean | null;
  readonly output: string;
  /** False for the local driver, so the UI can keep saying so. */
  readonly isIsolated: boolean;
}

/**
 * Start (or restart) a preview for a build project.
 *
 * Returns install/check output even on failure, because a build that generated
 * files but failed to compile is still something the user should see and can
 * ask Reklu to fix (spec §88).
 */
export async function startPreview(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly report?: BuildStageReporter;
}): Promise<StartPreviewResult> {
  const status = sandboxStatus();
  if (!status.available) {
    throw errors.notConfigured({
      feature: 'Preview',
      requiredEnv: ['SANDBOX_DRIVER'],
      docsPath: '/settings',
    });
  }

  const [project] = await db
    .select()
    .from(buildProjects)
    .where(
      and(
        eq(buildProjects.id, params.buildProjectId),
        eq(buildProjects.workspaceId, params.workspaceId),
        isNull(buildProjects.deletedAt),
      ),
    )
    .limit(1);

  if (!project) throw errors.notFound('Build project', params.buildProjectId);

  const files = await loadTree(params.buildProjectId, params.workspaceId);
  if (files.length === 0) {
    throw errors.validation('There is nothing to preview yet. Generate the application first.');
  }

  // Replace any previous preview for this project rather than accumulating.
  await stopPreview(params.buildProjectId, params.workspaceId);

  const report: BuildStageReporter = params.report ?? (() => undefined);
  const sandboxId = newId('sandbox');
  const port = await findFreePort();

  const [row] = await db
    .insert(sandboxes)
    .values({
      id: sandboxId,
      buildProjectId: params.buildProjectId,
      workspaceId: params.workspaceId,
      driver: status.driver,
      status: 'provisioning',
      port,
      memoryLimitMb: 2_048,
      diskLimitMb: 1_024,
      timeoutMs: 300_000,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    })
    .returning({ id: sandboxes.id });

  try {
    const materialized = await materialize({
      sandboxId,
      files,
      report,
      runChecks: false,
    });

    if (!materialized.installed) {
      await db
        .update(sandboxes)
        .set({ status: 'failed', errorMessage: materialized.output.slice(0, 4_000) })
        .where(eq(sandboxes.id, sandboxId));

      return {
        url: '',
        port,
        sandboxId,
        installed: false,
        checksPassed: false,
        output: materialized.output,
        isIsolated: status.isolated,
      };
    }

    await report('starting_preview');

    /*
     * The command comes from the generated package.json, not from a guess.
     * Nothing started the application at all before this — the E2B driver
     * returned a public URL for a port that had no server on it — and a wrong
     * command fails in the same way, so the manifest decides.
     */
    const manifest = parseManifest(
      files.find((file) => file.path === 'package.json')?.content,
    );
    const devCommand = devCommandFor(manifest, port);

    const handle = await sandbox().startPreview(materialized.handle, port, devCommand);
    running.set(params.buildProjectId, handle);

    await db
      .update(sandboxes)
      .set({
        status: 'running',
        externalId: materialized.handle.externalId,
        previewUrl: handle.url,
        lastActiveAt: new Date(),
      })
      .where(eq(sandboxes.id, row!.id));

    logger.info('Preview started', {
      buildProjectId: params.buildProjectId,
      port,
      isolated: status.isolated,
    });

    return {
      url: handle.url,
      port,
      sandboxId,
      installed: true,
      checksPassed: null,
      output: materialized.output,
      isIsolated: status.isolated,
    };
  } catch (error) {
    await db
      .update(sandboxes)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message.slice(0, 4_000) : 'Preview failed',
      })
      .where(eq(sandboxes.id, sandboxId));
    throw error;
  }
}

/** Stop a project's preview and mark its sandbox stopped. */
export async function stopPreview(
  buildProjectId: string,
  workspaceId: string,
): Promise<void> {
  const handle = running.get(buildProjectId);
  if (handle) {
    await handle.stop().catch(() => undefined);
    running.delete(buildProjectId);
  }

  await db
    .update(sandboxes)
    .set({ status: 'stopped', stoppedAt: new Date(), previewUrl: null })
    .where(
      and(
        eq(sandboxes.buildProjectId, buildProjectId),
        eq(sandboxes.workspaceId, workspaceId),
        ne(sandboxes.status, 'stopped'),
      ),
    );
}

/** The live preview for a project, if one is running. */
export async function currentPreview(
  buildProjectId: string,
  workspaceId: string,
): Promise<{ url: string; port: number; isIsolated: boolean } | undefined> {
  const [row] = await db
    .select({ previewUrl: sandboxes.previewUrl, port: sandboxes.port })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, buildProjectId),
        eq(sandboxes.workspaceId, workspaceId),
        eq(sandboxes.status, 'running'),
      ),
    )
    .limit(1);

  if (!row?.previewUrl) return undefined;

  // Only report a preview the process actually still holds. A row surviving a
  // restart would otherwise point at a dead port.
  if (!running.has(buildProjectId)) return undefined;

  return {
    url: row.previewUrl,
    port: row.port ?? 0,
    isIsolated: sandboxStatus().isolated,
  };
}
