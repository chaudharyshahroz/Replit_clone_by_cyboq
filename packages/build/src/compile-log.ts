/**
 * Extract the current compiler failure from an append-only development log.
 *
 * Kept in the build package because both the preview runtime and the web UI
 * need the same answer. If they disagree, the runtime can call a preview ready
 * while the UI calls it broken (or the reverse).
 */
const FAILURE_MARKERS = [
  'Failed to compile',
  'Module not found',
  'Unknown weight',
  'Missing weight',
  'SyntaxError',
  'Syntax Error',
  'Syntax error:',
  'Unexpected token',
  'Type error:',
];

const RECOVERY_MARKERS = ['Compiled successfully', 'compiled successfully', 'Compiled /'];

const RUNTIME_FAILURE_MARKERS = [
  'PrismaClientInitializationError',
  'PrismaClientKnownRequestError',
  '@prisma/client did not initialize',
  'Environment variable not found',
  'Missing environment variable',
  'Missing required environment variable',
  'Invalid src prop',
  'Dynamic server usage',
  'ERR_MODULE_NOT_FOUND',
  'Cannot find package',
  'ReferenceError:',
  'TypeError:',
  '⨯ Error:',
  '⨯ TypeError:',
  '⨯ ReferenceError:',
];

const STARTUP_INFRASTRUCTURE_FAILURES =
  /EADDRINUSE|ENOSPC|no space left|heap out of memory|JavaScript heap|spawn\s+\S+\s+ENOENT/i;

const STARTUP_FAILURE_MARKERS = [
  'REKLU_PREVIEW_EXIT_CODE=',
  'failed to load config',
  'failed to resolve import',
  'error when starting dev server',
  'npm error Missing script',
  'command not found',
  'CssSyntaxError',
  'ERR_REQUIRE_ESM',
  'ELIFECYCLE',
  "trying to use `tailwindcss` directly as a PostCSS plugin",
  'Cannot apply unknown utility class',
];

function lastPosition(log: string, markers: readonly string[]): number | undefined {
  return markers
    .map((marker) => log.lastIndexOf(marker))
    .filter((position) => position !== -1)
    .sort((a, b) => b - a)[0];
}

export function compileErrorIn(log: string): string | null {
  if (!log.trim()) return null;

  const failedAt = lastPosition(log, FAILURE_MARKERS);

  if (failedAt === undefined) return null;

  const recoveredAt = RECOVERY_MARKERS.map((marker) => log.lastIndexOf(marker)).sort(
    (a, b) => b - a,
  )[0]!;
  if (recoveredAt > failedAt) return null;

  const from = Math.max(0, failedAt - 400);
  return log.slice(from, from + 1_800).trim();
}

/**
 * A failure that prevents the preview page from becoming healthy.
 *
 * Next can compile successfully and then throw while rendering `/`. Missing
 * database credentials and SDK configuration take this path: the process is
 * alive, the health request returns 500, and looking only for compiler markers
 * incorrectly reports that the server never started. Keep this separate from
 * `compileErrorIn` so callers can describe the failure accurately.
 */
export function runtimeErrorIn(log: string): string | null {
  if (!log.trim()) return null;
  const failedAt = lastPosition(log, RUNTIME_FAILURE_MARKERS);
  if (failedAt === undefined) return null;

  /* A later successful request proves the current page recovered even though
   * the append-only log still contains its old stack trace. */
  const after = log.slice(failedAt);
  const recovered = /(?:GET|POST|HEAD)\s+\/\S*\s+(?:2\d\d|3\d\d)\b/.exec(after);
  if (recovered) return null;

  return log.slice(Math.max(0, failedAt - 500), failedAt + 2_500).trim();
}

/**
 * A generated-project failure that terminates the dev command before the
 * framework can emit its normal compiler markers.
 *
 * Vite config failures, PostCSS/Tailwind setup errors and missing npm scripts
 * all take this route. They used to be reported as an unexplained timeout and
 * were never offered to the automatic repair pass. Host/resource failures are
 * deliberately excluded because changing generated code cannot repair them.
 */
export function startupErrorIn(log: string): string | null {
  if (!log.trim() || STARTUP_INFRASTRUCTURE_FAILURES.test(log)) return null;

  let failedAt = lastPosition(log, STARTUP_FAILURE_MARKERS);

  const genericErrors = /(?:^|\n)(?:Error(?: \[[A-Z_]+\])?|[A-Za-z]+Error):/g;
  for (const match of log.matchAll(genericErrors)) {
    const position = match.index;
    if (position !== undefined && (failedAt === undefined || position > failedAt)) {
      failedAt = position;
    }
  }

  if (failedAt === undefined) return null;
  const recoveredAt = lastPosition(log, RECOVERY_MARKERS);
  if (recoveredAt !== undefined && recoveredAt > failedAt) return null;

  return log.slice(Math.max(0, failedAt - 500), failedAt + 2_500).trim();
}

/** The actionable compiler or render failure currently blocking a preview. */
export function previewErrorIn(log: string): string | null {
  return compileErrorIn(log) ?? runtimeErrorIn(log) ?? startupErrorIn(log);
}
