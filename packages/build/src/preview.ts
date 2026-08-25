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
import {
  DEV_LOG_PATH,
  sandbox,
  sandboxStatus,
  type PreviewHandle,
  type SandboxHandle,
} from '@reklu/sandbox';
import { errors, logger, newId } from '@reklu/shared';
import { devCommandFor, parseManifest } from './dev-command';
import { materialize, type BuildStageReporter } from './generate';
import { loadTree } from './versions';
import { withImageBytes } from './artwork';
import type { GeneratedFile } from './parse';

/** Previews live on a dedicated range, well away from Reklu's own port. */
const PORT_RANGE_START = 43_000;
const PORT_RANGE_END = 43_200;

/** What a preview sandbox is allowed, and what destroying one needs to know. */
const DEFAULT_PREVIEW_LIMITS = {
  timeoutMs: 300_000,
  memoryMb: 2_048,
  diskMb: 1_024,
  maxOutputBytes: 512_000,
} as const;

/** Previews are reaped after this long idle. */
const PREVIEW_TTL_MS = 30 * 60 * 1000;

/** In-process handles, so a preview can be stopped without re-spawning. */
const running = new Map<string, PreviewHandle>();

/**
 * Destroy any sandbox this build left behind.
 *
 * Container drivers keep the sandbox alive after a preview stops — it is reused
 * for the next edit — so nothing was ever reclaiming them. Every preview left a
 * container running, holding its published port and its memory, and the next
 * one collided with it. Called before creating a new sandbox rather than only
 * on an explicit stop, because the case that leaks is the one where nobody
 * pressed stop.
 */
async function destroyPreviousSandboxes(
  buildProjectId: string,
  workspaceId: string,
): Promise<void> {
  const stale = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId, port: sandboxes.port })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, buildProjectId),
        eq(sandboxes.workspaceId, workspaceId),
        ne(sandboxes.status, 'stopped'),
      ),
    );

  const driver = sandbox();

  for (const row of stale) {
    if (row.externalId) {
      await driver
        .destroy({
          id: row.id,
          driver: driver.name,
          externalId: row.externalId,
          limits: DEFAULT_PREVIEW_LIMITS,
          isIsolated: driver.isIsolated,
        })
        .catch((error: unknown) => {
          // Already gone is the common case and is success.
          logger.debug('Could not destroy a previous sandbox', { id: row.id, error });
        });
    }

    await db
      .update(sandboxes)
      .set({ status: 'stopped', stoppedAt: new Date(), previewUrl: null })
      .where(eq(sandboxes.id, row.id));
  }
}

/**
 * Write the new files into the container that is already serving this build.
 *
 * Returns undefined whenever anything is uncertain — no sandbox recorded, the
 * container gone, the process handle lost across a restart — so the caller
 * falls back to building a fresh one. Being wrong here would show someone a
 * preview of an application that is no longer there.
 */
async function reuseRunningSandbox(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly report?: BuildStageReporter;
}): Promise<StartPreviewResult | undefined> {
  const handle = running.get(params.buildProjectId);
  if (!handle) return undefined;

  const [row] = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId, port: sandboxes.port })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, params.buildProjectId),
        eq(sandboxes.workspaceId, params.workspaceId),
        eq(sandboxes.status, 'running'),
      ),
    )
    .limit(1);

  if (!row?.externalId) return undefined;

  const driver = sandbox();
  const sandboxHandle = {
    id: row.id,
    driver: driver.name,
    externalId: row.externalId,
    limits: DEFAULT_PREVIEW_LIMITS,
    isIsolated: driver.isIsolated,
  };

  const files = await loadTree(params.buildProjectId, params.workspaceId);
  if (files.length === 0) return undefined;

  try {
    /*
     * Asked of the container itself, not assumed from a database row. A row
     * survives a restart that the container did not.
     */
    const alive = await driver.exec(sandboxHandle, {
      command: 'sh',
      args: ['-c', 'true'],
      timeoutMs: 10_000,
    });
    if (alive.exitCode !== 0) return undefined;

    /*
     * Dependencies only when they changed. Comparing the manifest against the
     * one in the container is a single read, and it is the difference between
     * an edit that reloads in a second and one that reinstalls for a minute.
     */
    const manifest = files.find((file) => file.path === 'package.json');
    let needsInstall = false;

    if (manifest) {
      const current = (await driver.readFile(sandboxHandle, 'package.json').catch(() => '')) ?? '';
      needsInstall = current.trim() !== manifest.content.trim();
    }

    await params.report?.('generating_files', 'Updating the running preview');
    await driver.writeFiles(
      sandboxHandle,
      await withImageBytes(files),
    );

    if (needsInstall) {
      await params.report?.('installing_dependencies');
      const install = await driver.exec(sandboxHandle, {
        command: 'npm',
        args: ['install', '--no-audit', '--no-fund'],
        timeoutMs: 600_000,
      });

      if (install.exitCode !== 0) {
        logger.warn('Install failed in a reused sandbox; rebuilding it', {
          buildProjectId: params.buildProjectId,
        });
        return undefined;
      }
    }

    logger.info('Reused a running sandbox for an edit', {
      buildProjectId: params.buildProjectId,
      reinstalled: needsInstall,
    });

    return {
      url: handle.url,
      port: row.port ?? handle.port,
      sandboxId: row.id,
      installed: true,
      checksPassed: null,
      output: '',
      isIsolated: driver.isIsolated,
    };
  } catch (error) {
    logger.debug('Could not reuse the running sandbox; building a fresh one', {
      buildProjectId: params.buildProjectId,
      error,
    });
    return undefined;
  }
}

/** How long a dev server is given to compile before the preview opens anyway. */
const READY_TIMEOUT_MS = 90_000;

/**
 * Block until the application answers on its port, or until it has had long
 * enough.
 *
 * Returning anyway on timeout is deliberate. A server that is slow is still
 * worth showing — the frame will fill in when it finishes — whereas refusing to
 * open a preview because compilation took ninety seconds would turn a slow
 * build into a failed one.
 */
async function waitForServer(
  handle: SandboxHandle,
  port: number,
  report: BuildStageReporter,
): Promise<boolean> {
  const driver = sandbox();
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let announced = false;

  while (Date.now() < deadline) {
    try {
      const result = await driver.exec(handle, {
        command: 'node',
        args: [
          '-e',
          /*
           * Any answer at all counts, including a 500. The question is whether
           * something is listening and compiled enough to respond — a server
           * returning an error page is one the frame can show, and showing it
           * is how the error becomes visible.
           */
          `fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(4000)})` +
            `.then(()=>process.exit(0)).catch(()=>process.exit(1))`,
        ],
        timeoutMs: 8_000,
      });

      if (result.exitCode === 0) return true;
    } catch {
      // The container may still be starting; that is what the loop is for.
    }

    if (!announced) {
      announced = true;
      await report('starting_preview', 'Waiting for the dev server to compile');
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  logger.warn('Dev server did not answer before the preview opened', { port });
  return false;
}

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
/**
 * Push the current files into a preview that is already running.
 *
 * Called when a generation finishes. Without it, an edit wrote new files to the
 * database, the page refreshed, the frame reloaded — and the container went on
 * serving what it was given the last time somebody pressed a button. The change
 * was real, was visible in the code, and was nowhere on the screen.
 *
 * Does nothing when no preview is running, because there is nothing to update
 * and starting one uninvited would install a dependency tree nobody asked for.
 */
export async function syncPreview(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly report?: BuildStageReporter;
}): Promise<boolean> {
  try {
    return Boolean(await reuseRunningSandbox(params));
  } catch (error) {
    /*
     * Never fatal. The generation succeeded and the files are saved; a preview
     * that could not be updated is worth a line in the log, not the loss of the
     * work that produced it.
     */
    logger.warn('The running preview could not be updated', {
      buildProjectId: params.buildProjectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

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

  const report: BuildStageReporter = params.report ?? (() => undefined);

  /*
   * Reuse what is already running, before anything is torn down.
   *
   * This used to sit *after* the call that stops the previous preview, which
   * destroys the container and empties the map this reads — so it never found
   * anything, and every preview reinstalled the dependency tree from nothing.
   * A minute of waiting to see a one-line change, on a machine that had a
   * working copy of the application a few seconds earlier.
   *
   * Writing the changed files into the running container and letting the dev
   * server reload them is what a dev server is for.
   */
  const reused = await reuseRunningSandbox(params);
  if (reused) return reused;

  // Nothing to reuse. Replace any previous preview rather than accumulating.
  await stopPreview(params.buildProjectId, params.workspaceId);

  /*
   * Reclaim first. Otherwise each preview leaves its predecessor running, and
   * the second one fails to bind a port the first still holds — which surfaces
   * as "preview could not start" on a build that was fine.
   */
  await destroyPreviousSandboxes(params.buildProjectId, params.workspaceId);
  running.delete(params.buildProjectId);

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
      // Fixed at creation for container runtimes; ignored by drivers that do
      // not need it.
      publishPort: port,
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

    /*
     * Wait until it can actually answer.
     *
     * Starting the process and calling that "started" is what produced a white
     * frame that worked on reload: a dev server accepts the command instantly
     * and then spends several seconds compiling, so the first request arrives
     * before anything is listening. Opening the same URL by hand a moment later
     * worked, which made it look like Reklu's frame was at fault rather than its
     * timing.
     *
     * Asked from inside the container, so this is the server answering rather
     * than a proxy or a DNS record that may not have caught up yet.
     */
    await waitForServer(materialized.handle, port, report);

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

  /*
   * The sandbox goes too. On a container driver `stop()` releases nothing —
   * the container outlives the preview by design — so stopping without this
   * left a container running for every build ever previewed.
   */
  await destroyPreviousSandboxes(buildProjectId, workspaceId);
}

/**
 * What the preview server has printed.
 *
 * The dev server's own output is where a compile error appears — and until it
 * was captured, that error existed only in the browser tab of whoever opened
 * the preview. Reklu could not see it, so the Console tab it offers for exactly
 * this question was empty while the answer sat inside the container.
 */
export async function previewLogs(
  buildProjectId: string,
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, buildProjectId),
        eq(sandboxes.workspaceId, workspaceId),
        eq(sandboxes.status, 'running'),
      ),
    )
    .limit(1);

  if (!row?.externalId) return '';

  const driver = sandbox();

  try {
    const result = await driver.exec(
      {
        id: row.id,
        driver: driver.name,
        externalId: row.externalId,
        limits: DEFAULT_PREVIEW_LIMITS,
        isIsolated: driver.isIsolated,
      },
      {
        command: 'sh',
        // Bounded: a dev server left running for an hour writes a lot, and the
        // useful part is always the end.
        args: ['-c', `tail -c 20000 ${DEV_LOG_PATH} 2>/dev/null || true`],
        timeoutMs: 15_000,
      },
    );

    return result.stdout || result.stderr;
  } catch (error) {
    logger.debug('Could not read preview logs', { buildProjectId, error });
    return '';
  }
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
