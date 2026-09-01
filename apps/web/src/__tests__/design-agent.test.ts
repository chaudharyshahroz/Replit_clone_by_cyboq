import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('build Design Director orchestration', () => {
  it('uses a dedicated design model, contract, critic and one bounded refinement', async () => {
    const source = await readFile(join(process.cwd(), 'src/app/(app)/build/actions.ts'), 'utf8');
    const generation = source.slice(source.indexOf('async function runGeneration'));
    const designBlock = generation.slice(
      generation.indexOf('if (firstGeneration && needsDesignPass'),
      generation.indexOf('// Spec §35'),
    );

    expect(designBlock).toContain('pickDesignModel(model)');
    expect(designBlock).toContain('createDesignContract(brief, plan)');
    expect(designBlock).toContain('auditDesignQuality(brief, merged)');
    expect(designBlock.match(/await runDesignPass\(/g)).toHaveLength(2);
    expect(designBlock).not.toMatch(/while\s*\(|for\s*\(/);
  });
});
