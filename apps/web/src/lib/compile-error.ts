/**
 * Find a compile failure in a dev server's output.
 *
 * The dev server keeps running when the application fails to compile — it just
 * serves an error page — so nothing in Reklu's own state says anything is
 * wrong. The evidence is in the log, and this is what reads it.
 *
 * Deliberately narrow. A warning is not a failure, and offering to "fix" a
 * deprecation notice would spend a model call and a minute of someone's time
 * on nothing.
 */
const FAILURE_MARKERS = [
  'Failed to compile',
  'Module not found',
  'Unknown weight',
  'Missing weight',
  'SyntaxError',
  'Syntax error:',
  'Type error:',
];

const RECOVERY_MARKERS = ['Compiled successfully', 'compiled successfully', 'Compiled /'];

export function compileErrorIn(log: string): string | null {
  if (!log.trim()) return null;

  const failedAt = FAILURE_MARKERS.map((marker) => log.lastIndexOf(marker))
    .filter((position) => position !== -1)
    .sort((a, b) => b - a)[0];

  if (failedAt === undefined) return null;

  /* A successful hot reload supersedes errors earlier in the append-only log. */
  const recoveredAt = RECOVERY_MARKERS.map((marker) => log.lastIndexOf(marker)).sort(
    (a, b) => b - a,
  )[0]!;
  if (recoveredAt > failedAt) return null;

  const from = Math.max(0, failedAt - 400);
  return log.slice(from, from + 1_800).trim();
}
