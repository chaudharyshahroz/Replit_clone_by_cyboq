import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), '../..', path), 'utf8');
}

describe('explicit-only provider routing', () => {
  it('filters chat, research, build, create and agent automatic choices centrally', async () => {
    const files = await Promise.all([
      source('apps/web/src/app/api/chat/route.ts'),
      source('apps/web/src/app/api/research/route.ts'),
      source('apps/web/src/app/(app)/build/actions.ts'),
      source('apps/worker/src/handlers/research.ts'),
      source('packages/create/src/generate.ts'),
      source('packages/agents/src/runner.ts'),
    ]);

    for (const contents of files) {
      expect(contents).toContain('autoRoutableModels');
    }
  });
});
