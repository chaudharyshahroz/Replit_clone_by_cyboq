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

/** The actionable compiler or render failure currently blocking a preview. */
export function previewErrorIn(log: string): string | null {
  return compileErrorIn(log) ?? runtimeErrorIn(log);
}
