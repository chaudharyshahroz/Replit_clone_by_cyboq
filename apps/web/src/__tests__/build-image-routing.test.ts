import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Build image model routing', () => {
  it('never sends an attached image to a text-only model', async () => {
    const source = await readFile(join(process.cwd(), 'src/app/(app)/build/actions.ts'), 'utf8');

    expect(source).toContain('(!needsVision || model.supportsVision)');
    expect(source).toContain("file.contentType.startsWith('image/')");
    expect(source).toContain('pickModel(requestedModel, [], needsVision)');
    /*
     * The fallback must still ask for vision when the turn carries an image.
     * Matched without the closing bracket because the call also passes what a
     * substitute may cost and which provider it may come from; pinning the
     * whole call text made an unrelated argument break this guard.
     */
    expect(source).toContain('pickModel(undefined, attempted, images.length > 0');
  });
});
