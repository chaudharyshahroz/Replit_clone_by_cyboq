import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * E2B is exercised against the real provider by verify:e2b, not unit tests.
 * Keep the production-only logging contract covered without requiring network
 * access or an API key in the ordinary test suite.
 */
describe('E2B preview logging', () => {
  it('persists background server output where preview diagnostics read it', async () => {
    const source = await readFile(new URL('../drivers/e2b.ts', import.meta.url), 'utf8');
    const start = source.slice(source.indexOf('async startPreview'));

    expect(source).toContain("import { previewProcessCommand } from '../preview-runtime'");
    expect(start).toContain('previewProcessCommand(command)');
    expect(start.indexOf('previewProcessCommand(command)')).toBeLessThan(
      start.indexOf('background: true'),
    );
  });

  it('uses an explicit managed-sandbox lifetime when the caller supplies one', async () => {
    const source = await readFile(new URL('../drivers/e2b.ts', import.meta.url), 'utf8');
    const create = source.slice(source.indexOf('async create'), source.indexOf('async writeFiles'));

    expect(create).toContain('createOptions?.lifetimeMs ?? limits.timeoutMs');
  });

  it('keeps the Node runtime separate from the browser used for visual review', async () => {
    const source = await readFile(new URL('../drivers/e2b.ts', import.meta.url), 'utf8');
    const create = source.slice(source.indexOf('async create'), source.indexOf('async writeFiles'));
    const capture = source.slice(source.indexOf('async capturePreview'));

    expect(create).toContain('Sandbox.create({');
    expect(create).not.toContain("DesktopSandbox.create('desktop'");
    expect(capture).toContain("DesktopSandbox.create('desktop'");
    expect(capture).toContain('await browser?.kill()');
  });
});
