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
const MARKERS = [
  'Failed to compile',
  'Module not found',
  'Unknown weight',
  'Missing weight',
  'SyntaxError',
  'Syntax error:',
  'Type error:',
];

export function compileErrorIn(log: string): string | null {
  if (!log.trim()) return null;

  const index = MARKERS.map((marker) => log.lastIndexOf(marker))
    .filter((position) => position !== -1)
    .sort((a, b) => b - a)[0];

  if (index === undefined) return null;

  /*
   * Development-server logs are append-only. Once hot reload compiles a repair,
   * the old error remains in the file; treating it as current leaves the red
   * banner up forever and keeps offering to fix code that is already working.
   */
  const recoveredAt = [
    log.lastIndexOf('Compiled successfully'),
    log.lastIndexOf('compiled successfully'),
    log.lastIndexOf('Compiled /'),
  ].sort((a, b) => b - a)[0]!;
  if (recoveredAt > index) return null;

  /*
   * A little before, so the file path above the message comes too, and a bounded
   * amount after. The model needs the location as much as the complaint.
   */
  const from = Math.max(0, index - 400);
  return log.slice(from, from + 1_800).trim();
}
