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
import { and, desc, eq, gte, isNull, lt, ne } from 'drizzle-orm';
import { buildProjects, db, sandboxes } from '@reklu/database';
import {
  DEV_LOG_PATH,
  sandbox,
  sandboxStatus,
  type PreviewHandle,
  type SandboxHandle,
  type PreviewScreenshot,
} from '@reklu/sandbox';
import { errors, logger, newId } from '@reklu/shared';
import { devCommandFor, parseManifest } from './dev-command';
import { materialize, type BuildStageReporter } from './generate';
import { loadTree } from './versions';
import { dependencyInstallCommand } from './install-args';
import { withImageBytes } from './artwork';
import type { GeneratedFile } from './parse';
import { previewErrorIn } from './compile-log';
import { previewEntryProblem, previewHealthCheck } from './preview-entry';
import { normalizeGeneratedTree } from './normalize-tree';

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

/**
 * How many preview containers may run at once, across every project.
 *
 * A preview is a Node process holding a compiler, and the host is one machine.
 * Without a ceiling, the number running is however many builds anybody has
 * opened since the last restart — and each one that does not fit takes memory
 * from the ones that do, until the box stops answering and the whole
 * deployment looks down rather than busy.
 */
const MAX_RUNNING_PREVIEWS = 4;

/** In-process handles, so a preview can be stopped without re-spawning. */
const running = new Map<string, PreviewHandle>();

/** Files created by package managers rather than stored in the generated tree. */
const RUNTIME_FILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', DEV_LOG_PATH]);
const RESTART_SENSITIVE_FILES = new Set([
  'package.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsconfig.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
]);

export function staleProjectFiles(
  currentFiles: readonly string[],
  sandboxFiles: readonly string[],
): readonly string[] {
  const current = new Set(currentFiles);
  return sandboxFiles.filter((path) => !current.has(path) && !RUNTIME_FILES.has(path));
}

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
/**
 * Destroy previews that nobody is watching any more.
 *
 * `expiresAt` was written on every sandbox from the beginning and read by
 * nothing: the column existed, the index existed, the TTL constant existed, and
 * no query ever selected on it. So a preview container lived until that same
 * project was previewed again — meaning the number of Node processes on the
 * host was the number of builds anyone had opened, for ever.
 *
 * That is the shape of a host that works fine and then stops answering: nothing
 * fails, memory is simply consumed by containers serving pages nobody is
 * looking at, and the first visible symptom is the proxy timing out on requests
 * that used to be instant.
 */
export async function reapIdleSandboxes(): Promise<number> {
  const driver = sandbox();
  const now = new Date();

  const expired = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId })
    .from(sandboxes)
    .where(and(ne(sandboxes.status, 'stopped'), lt(sandboxes.expiresAt, now)));

  /*
   * Over the ceiling as well as over the deadline. A run of previews inside the
   * TTL can still exhaust the host, so the least recently used go first — they
   * are the ones nobody is looking at.
   */
  const live = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId })
    .from(sandboxes)
    .where(and(ne(sandboxes.status, 'stopped'), gte(sandboxes.expiresAt, now)))
    .orderBy(desc(sandboxes.lastActiveAt));

  const surplus = live.slice(MAX_RUNNING_PREVIEWS);
  const doomed = [...expired, ...surplus];
  if (doomed.length === 0) return 0;

  for (const row of doomed) {
    if (row.externalId) {
      await driver
        .destroy({
          id: row.id,
          driver: driver.name,
          externalId: row.externalId,
          limits: DEFAULT_PREVIEW_LIMITS,
          isIsolated: driver.isIsolated,
        })
        .catch((error) => logger.warn('Could not reap a sandbox', { id: row.id, error }));
    }

    await db
      .update(sandboxes)
      .set({ status: 'stopped', stoppedAt: new Date() })
      .where(eq(sandboxes.id, row.id));

    running.delete(row.id);
  }

  logger.info('Reaped idle preview sandboxes', {
    expired: expired.length,
    surplus: surplus.length,
  });
  return doomed.length;
}

async function destroyPreviousSandboxes(
  buildProjectId: string,
  workspaceId: string,
): Promise<void> {
  const stale = await db
    .select({
      id: sandboxes.id,
      externalId: sandboxes.externalId,
      port: sandboxes.port,
      previewUrl: sandboxes.previewUrl,
    })
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
  /*
   * The database row is the record of what is running, not the in-memory map.
   *
   * This began by returning early unless `running` held a handle, and then
   * rebuilt the handle from the row below without ever using the one it had
   * checked for. The map is per process: it is empty after a deploy, after a
   * restart, and in any worker that did not start the container — so on a
   * deployed instance the reuse path was almost always skipped, and an edit
   * only reached the preview when somebody pressed Restart and built a fresh
   * container. Which is exactly what it looked like from outside.
   *
   * What the row cannot tell us is whether the container is still alive, and
   * that is asked of the container itself a few lines down.
   */
  const [row] = await db
    .select({
      id: sandboxes.id,
      externalId: sandboxes.externalId,
      port: sandboxes.port,
      previewUrl: sandboxes.previewUrl,
    })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, params.buildProjectId),
        eq(sandboxes.workspaceId, params.workspaceId),
        eq(sandboxes.status, 'running'),
      ),
    )
    .limit(1);

  /* No address means nothing to send anybody to, whatever the row says. */
  if (!row?.externalId || !row.previewUrl) return undefined;

  const driver = sandbox();
  const sandboxHandle = {
    id: row.id,
    driver: driver.name,
    externalId: row.externalId,
    limits: DEFAULT_PREVIEW_LIMITS,
    isIsolated: driver.isIsolated,
  };

  const files = normalizeGeneratedTree(await loadTree(params.buildProjectId, params.workspaceId));
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

    /*
     * A write-only sync leaves renamed and deleted source files behind. When
     * constants.ts is repaired to constants.tsx, Next resolves the stale .ts
     * first and reports the same syntax error forever. Mirror the stored tree,
     * while retaining package-manager state and ignored build/dependency dirs.
     */
    const existingPaths = await driver.listFiles(sandboxHandle);
    const stalePaths = staleProjectFiles(
      files.map((file) => file.path),
      existingPaths,
    );
    if (stalePaths.length > 0) {
      const removed = await driver.exec(sandboxHandle, {
        command: 'rm',
        args: ['-f', '--', ...stalePaths],
        timeoutMs: 10_000,
      });
      if (removed.exitCode !== 0) {
        logger.warn('Could not remove stale preview files; rebuilding the sandbox', {
          buildProjectId: params.buildProjectId,
          output: (removed.stderr || removed.stdout).slice(-2_000),
        });
        return undefined;
      }
    }

    /*
     * Next restarts its whole process whenever next.config or tsconfig is
     * touched, even if the bytes are identical. Repair used to rewrite the
     * entire tree three times, producing three 1.5–2 second restarts before it
     * could reveal the next compiler error. Compare the handful of restart-
     * sensitive files and leave identical ones untouched; ordinary source
     * files still use the fast hot-reload path.
     */
    const unchanged = new Set<string>();
    await Promise.all(
      files
        .filter((file) => RESTART_SENSITIVE_FILES.has(file.path) && !file.binary)
        .map(async (file) => {
          const current = await driver.readFile(sandboxHandle, file.path).catch(() => undefined);
          if (current === file.content) unchanged.add(file.path);
        }),
    );
    await driver.writeFiles(
      sandboxHandle,
      await withImageBytes(files.filter((file) => !unchanged.has(file.path))),
    );

    if (needsInstall) {
      await params.report?.('installing_dependencies');
      const install = await driver.exec(sandboxHandle, {
        ...dependencyInstallCommand(),
        timeoutMs: 600_000,
      });

      if (install.exitCode !== 0) {
        /*
         * With the output. Without it this said only that an install had
         * failed, and the rebuild that follows fails the same way for the same
         * reason — so the log recorded two attempts and neither cause.
         */
        logger.warn('Install failed in a reused sandbox; rebuilding it', {
          buildProjectId: params.buildProjectId,
          exitCode: install.exitCode,
          output: (install.stderr || install.stdout).slice(-4_000),
        });
        return undefined;
      }
    }

    const entryProblem = previewEntryProblem(files);
    if (entryProblem) {
      return {
        url: row.previewUrl,
        port: row.port ?? 0,
        ready: false,
        sandboxId: row.id,
        installed: true,
        checksPassed: false,
        output: entryProblem,
        isIsolated: driver.isIsolated,
      };
    }

    const health = previewHealthCheck(files);
    const ready = await waitForServer(
      sandboxHandle,
      row.port ?? 0,
      health.path,
      health.requireOk,
      params.report ?? (() => undefined),
    );
    const output = ready ? '' : await readDevLog(sandboxHandle).catch(() => '');

    // A live container is not proof of a live dev server. Return to the fresh
    // provisioning path if there is no successful page and no compiler error
    // for the repair loop to fix (crashed process, changed command, or timeout).
    if (!ready) {
      if (!previewErrorIn(output)) return undefined;
      // Logs survive a crashed process. Do not keep repairing an old compiler
      // failure when nothing is listening anymore.
      const reachable = await driver.exec(sandboxHandle, {
        command: 'node',
        args: ['-e',
          `fetch('http://127.0.0.1:${row.port ?? 0}${health.path}',{signal:AbortSignal.timeout(4000)})` +
          '.then(()=>process.exit(0)).catch(()=>process.exit(1))',
        ],
        timeoutMs: 8_000,
      });
      if (reachable.exitCode !== 0) return undefined;
    }

    /*
     * Touched, so using a preview keeps it. Without this the deadline is set
     * once at creation and a preview somebody is actively editing is reaped
     * half an hour later in the middle of their work.
     */
    await db
      .update(sandboxes)
      .set({ lastActiveAt: new Date(), expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) })
      .where(eq(sandboxes.id, row.id));

    logger.info('Reused a running sandbox for an edit', {
      buildProjectId: params.buildProjectId,
      reinstalled: needsInstall,
    });

    return {
      url: row.previewUrl,
      port: row.port ?? 0,
      ready,
      sandboxId: row.id,
      installed: true,
      checksPassed: null,
      output,
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
 * A timeout is not readiness. The caller keeps the URL out of the frame and
 * surfaces the captured process output, rather than presenting a blank proxy or
 * framework error page as the generated application.
 */
/**
 * The dev server's own output, from inside the container.
 *
 * Where the reason lives when nothing came up: a port already taken, a missing
 * script, a compile error at boot. None of that reaches Reklu any other way.
 */
async function readDevLog(handle: SandboxHandle): Promise<string> {
  const driver = sandbox();
  const result = await driver.exec(handle, {
    command: 'sh',
    args: ['-c', `tail -c 8000 ${DEV_LOG_PATH} 2>/dev/null || true`],
    timeoutMs: 10_000,
  });
  return (result.stdout || '').trim();
}

async function waitForServer(
  handle: SandboxHandle,
  port: number,
  path: string,
  requireOk: boolean,
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
           * A visual preview is ready only when its actual page succeeds. API
           * and custom servers may deliberately answer root with a 4xx, which
           * still proves their process is reachable; a 5xx never counts.
           */
          `fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(4000)})` +
            `.then(r=>process.exit((r.ok||(${requireOk ? 'false' : 'true'}&&r.status<500))?0:2))` +
            `.catch(()=>process.exit(1))`,
        ],
        timeoutMs: 8_000,
      });

      if (result.exitCode === 0) return true;

      /*
       * A framework may keep serving a 500, or it may exit after a startup
       * exception. In both cases the log already contains the actionable code
       * failure; waiting the rest of the 90-second budget cannot change it.
       */
      if (result.exitCode !== 0) {
        const log = await readDevLog(handle).catch(() => '');
        if (previewErrorIn(log)) return false;
      }
    } catch {
      // The container may still be starting; that is what the loop is for.
    }

    if (!announced) {
      announced = true;
      await report('starting_preview', 'Waiting for the dev server to compile');
    }

    /* 1.5 seconds was visible latency after the page was already ready. */
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  /**
   * Whether anything ever answered on the port.
   *
   * This was computed and discarded. A dev server that never started left the
   * sandbox recorded as running and handed back a URL pointing at nothing — a
   * white frame, and a bare "Bad Gateway" from the proxy when opened directly.
   * Reklu knew, waited the full ninety seconds to find out, and said nothing.
   */
  readonly ready: boolean;
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
    return (await reuseRunningSandbox(params))?.ready ?? false;
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

/**
 * Ask the compiler what is wrong, in the container that already has the code.
 *
 * `next dev` reports type errors and keeps serving; `next build` refuses. So a
 * type error is invisible for as long as anybody is looking at the preview and
 * fatal the moment they publish — which is how the same project failed to
 * publish three times running, each time on a different line nobody had been
 * shown.
 *
 * Run where the dependencies already are. A typecheck needs the whole tree
 * resolved, and installing one somewhere else to ask a question the running
 * container can answer would cost more than the check.
 */
export async function typecheckPreview(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
}): Promise<string | undefined> {
  const [row] = await db
    .select({ id: sandboxes.id, externalId: sandboxes.externalId })
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
        command: 'npx',
        args: ['--no-install', 'tsc', '--noEmit', '--pretty', 'false'],
        timeoutMs: 240_000,
      },
    );

    if (result.exitCode === 0) return undefined;

    const output = `${result.stdout}\n${result.stderr}`.trim();

    /*
     * A project with no TypeScript, or no compiler installed, is not a project
     * with type errors. Reporting "tsc: not found" as something for a model to
     * fix would send it editing code that was never wrong.
     */
    if (!/error TS\d+/.test(output)) return undefined;

    /* The first errors only: the rest are usually the same mistake repeating. */
    return output
      .split('\n')
      .filter((line) => /error TS\d+/.test(line))
      .slice(0, 20)
      .join('\n');
  } catch (error) {
    logger.debug('Could not typecheck the preview', {
      buildProjectId: params.buildProjectId,
      error,
    });
    return undefined;
  }
}

/** Capture what the browser actually rendered, never by running it on Reklu's host. */
export async function captureRenderedPreview(params: {
  readonly buildProjectId: string;
  readonly workspaceId: string;
}): Promise<PreviewScreenshot | undefined> {
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

  if (!row?.externalId || !row.port) return undefined;
  const driver = sandbox();
  if (!driver.capturePreview) return undefined;

  return driver.capturePreview(
    {
      id: row.id,
      driver: driver.name,
      externalId: row.externalId,
      limits: DEFAULT_PREVIEW_LIMITS,
      isIsolated: driver.isIsolated,
    },
    row.port,
  );
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

  const files = normalizeGeneratedTree(await loadTree(params.buildProjectId, params.workspaceId));
  if (files.length === 0) {
    throw errors.validation('There is nothing to preview yet. Generate the application first.');
  }

  const entryProblem = previewEntryProblem(files);
  if (entryProblem) throw errors.validation(entryProblem);

  const report: BuildStageReporter = params.report ?? (() => undefined);

  /*
   * Before adding another. A host that is already at its ceiling should shed
   * the previews nobody is watching rather than refuse the one somebody is.
   */
  await reapIdleSandboxes().catch((error) =>
    logger.warn('Could not reap idle sandboxes', { error }),
  );

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
      // E2B otherwise treats the five-minute command timeout as the lifetime
      // of a preview that Reklu promises to keep for thirty minutes.
      sandboxLifetimeMs: PREVIEW_TTL_MS,
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
        ready: false,
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
    const health = previewHealthCheck(files);
    const ready = await waitForServer(
      materialized.handle,
      port,
      health.path,
      health.requireOk,
      report,
    );

    /*
     * The dev server's own output, which is where the reason is. Read only on
     * failure: on the happy path it is a compile log nobody needs.
     */
    let startupOutput = materialized.output;
    if (!ready) {
      const log = await readDevLog(materialized.handle).catch(() => '');
      // Once installation succeeded, the dev log is the relevant evidence.
      // Keeping hundreds of successful package-manager lines ahead of it made
      // repair prompts noisy and could push the actual startup error out.
      startupOutput = log || materialized.output;
      logger.warn('The dev server never answered', {
        buildProjectId: params.buildProjectId,
        port,
        log: log.slice(-2_000),
      });
    }

    const processExited = /REKLU_PREVIEW_EXIT_CODE=\d+/.test(startupOutput);
    const launchFailed = !ready && (processExited || !startupOutput.trim());

    await db
      .update(sandboxes)
      .set({
        status: launchFailed ? 'failed' : 'running',
        externalId: materialized.handle.externalId,
        previewUrl: handle.url,
        errorMessage: launchFailed ? startupOutput.slice(0, 4_000) || 'No preview process output.' : null,
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
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
      ready,
      checksPassed: null,
      output: startupOutput,
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
    .select({
      id: sandboxes.id,
      externalId: sandboxes.externalId,
      previewUrl: sandboxes.previewUrl,
      port: sandboxes.port,
    })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.buildProjectId, buildProjectId),
        eq(sandboxes.workspaceId, workspaceId),
        eq(sandboxes.status, 'running'),
      ),
    )
    .limit(1);

  if (!row?.previewUrl || !row.externalId || !row.port) return undefined;

  /*
   * The container is the source of truth, not this process's memory.
   *
   * Closing a browser keeps the container alive, while deploying Reklu clears
   * the `running` map. Requiring that map hid a healthy preview after either a
   * server replacement or a request landing on another web process. Verify the
   * actual dev server instead and reconnect to its stable URL.
   */
  const driver = sandbox();
  try {
    const reachable = await driver.exec(
      {
        id: row.id,
        externalId: row.externalId,
        driver: driver.name,
        limits: DEFAULT_PREVIEW_LIMITS,
        isIsolated: driver.isIsolated,
      },
      {
        command: 'node',
        args: [
          '-e',
          `fetch('http://127.0.0.1:${row.port}/',{signal:AbortSignal.timeout(4000)})` +
            '.then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))',
        ],
        timeoutMs: 8_000,
      },
    );
    if (reachable.exitCode !== 0) return undefined;
  } catch {
    return undefined;
  }

  await db
    .update(sandboxes)
    .set({ lastActiveAt: new Date(), expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) })
    .where(eq(sandboxes.id, row.id));

  return {
    url: row.previewUrl,
    port: row.port ?? 0,
    isIsolated: driver.isIsolated,
  };
}
