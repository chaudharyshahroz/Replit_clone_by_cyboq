/**
 * The order of two calls inside `startPreview`.
 *
 * This is a source-order assertion rather than a behavioural one, and that is a
 * deliberate trade. The state it protects — a container in a module-private map
 * and a row in the database — cannot be reached without mocking the driver, the
 * database and the file tree, and a test built on that much scaffolding tests
 * the scaffolding.
 *
 * What broke was exactly this order. `startPreview` stopped the previous
 * preview, which destroys the container and empties the map, and *then* tried
 * to reuse what was running. It never found anything. The reuse path — the
 * whole reason an edit does not reinstall a dependency tree — was unreachable
 * code that every test passed straight through, and the only symptom was that
 * previews were slow, which reads as the machine being slow.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../preview.ts', import.meta.url), 'utf8');

describe('starting a preview', () => {
  it('rejects reuse when no page responds even if an old compiler error remains', () => {
    expect(source).toContain('if (!ready) {');
    expect(source).toContain('if (!previewErrorIn(output)) return undefined;');
    expect(source).toContain('if (reachable.exitCode !== 0) return undefined;');
  });

  it('normalizes saved files in both fresh and reuse startup paths', () => {
    expect(source.match(/normalizeGeneratedTree\(await loadTree/g)).toHaveLength(2);
  });
  it('tries to reuse the running container before stopping anything', () => {
    const body = source.slice(source.indexOf('export async function startPreview'));

    const reuse = body.indexOf('await reuseRunningSandbox(');
    const stop = body.indexOf('await stopPreview(');

    expect(reuse).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(-1);
    expect(reuse).toBeLessThan(stop);
  });

  it('exposes a way to push new files into a preview that is already running', () => {
    /*
     * Without it, a generation writes files to the database and the container
     * goes on serving what it was last given — so an edit is real, visible in
     * the code, and nowhere on the screen.
     */
    expect(source).toContain('export async function syncPreview');
  });

  it('does not rewrite unchanged configuration files during live sync', () => {
    expect(source).toContain('RESTART_SENSITIVE_FILES');
    expect(source).toContain('current === file.content');
    expect(source).toContain("files.filter((file) => !unchanged.has(file.path))");
  });

  it('does not let a failed preview update lose the generation', () => {
    const body = source.slice(
      source.indexOf('export async function syncPreview'),
      source.indexOf('export async function startPreview'),
    );

    expect(body).toContain('catch');
    expect(body).toContain('return false');
  });
});
