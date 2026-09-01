import { describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn(() => ({ generate })));

vi.mock('@reklu/ai', () => ({ getProvider }));
vi.mock('@reklu/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reklu/shared')>()),
  loadServerEnv: () => ({
    NODE_ENV: 'test',
    RESEARCH_MAX_SOURCES: 32,
    RESEARCH_FETCH_TIMEOUT_MS: 1_000,
    RESEARCH_USER_AGENT: 'Reklu test',
  }),
}));

import { runResearch } from '../pipeline';
import type { SourceAdapter } from '../types';

const model = {
  providerKey: 'test',
  modelIdentifier: 'test-model',
  maxOutputTokens: 8_000,
} as never;

describe('latency-sensitive research', () => {
  it('plans queries in one call and searches them concurrently within the budget', async () => {
    generate
      .mockResolvedValueOnce({
        text: JSON.stringify({
          intent: 'compare restaurant websites',
          subQuestions: ['conversion patterns'],
          evidenceNeeded: ['real websites'],
          stoppingCondition: 'two useful examples',
          queries: ['restaurant website booking UX', 'restaurant website menu UX'],
        }),
      })
      .mockResolvedValueOnce({ text: 'Strong sites expose the menu and booking action early [1].' });

    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const search = vi.fn(async (query: string, limit: number) => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
      return [{
        kind: 'web' as const,
        url: null,
        title: query,
        snippet: null,
        domain: 'example.test',
        foundByQuery: query,
        localContent: `Evidence from ${query} showing menus, booking actions, opening hours and location details.`,
      }].slice(0, limit);
    });
    const adapter: SourceAdapter = { kind: 'web', isConfigured: () => true, search };

    const outcome = await runResearch({
      query: 'Analyze restaurant websites',
      mode: 'research',
      model,
      adapters: [adapter],
      budget: { queries: 2, perQuery: 4, reportTokens: 1_800 },
      report: () => {},
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.every((call) => call[1] === 4)).toBe(true);
    expect(outcome.queries).toHaveLength(2);
  });
});
