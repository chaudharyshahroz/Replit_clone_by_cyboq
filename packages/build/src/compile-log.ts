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

  const recoveredAt = RECOVERY_MARKERS.map((marker) => log.lastIndexOf(marker)).sort(
    (a, b) => b - a,
  )[0]!;
  if (recoveredAt > failedAt) return null;

  const from = Math.max(0, failedAt - 400);
  return log.slice(from, from + 1_800).trim();
}
