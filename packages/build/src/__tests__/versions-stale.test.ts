import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ lock: vi.fn(), insert: vi.fn() }));
vi.mock('@reklu/database', async (original) => {
  const actual = await original<typeof import('@reklu/database')>();
  return {
    ...actual,
    db: {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const query = {
          from: () => query,
          where: () => query,
          limit: () => query,
          for: (mode: string) => {
            state.lock(mode);
            return Promise.resolve([{ id: 'build', currentVersionId: 'newer' }]);
          },
        };
        return callback({ select: () => query, insert: state.insert });
      },
    },
  };
});

import { createCheckpoint } from '../versions';

describe('background checkpoint isolation', () => {
  it('locks and rejects a superseded version before writing any files', async () => {
    await expect(
      createCheckpoint({
        buildProjectId: 'build',
        workspaceId: 'workspace',
        userId: 'user',
        expectedVersionId: 'older',
        files: [
          {
            path: 'app/page.tsx',
            language: 'tsx',
            content: 'export default function Page() { return null; }',
          },
        ],
        changeSummary: 'Background image completion',
      }),
    ).rejects.toThrow(/superseded/i);
    expect(state.lock).toHaveBeenCalledWith('update');
    expect(state.insert).not.toHaveBeenCalled();
  });
});
