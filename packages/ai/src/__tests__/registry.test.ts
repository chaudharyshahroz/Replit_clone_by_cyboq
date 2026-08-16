import { describe, expect, it } from 'vitest';
import { groupByProvider, selectableModels, type RegisteredModel } from '../registry';
import type { PlanLimits } from '@reklu/database';

const model = (over: Partial<RegisteredModel> & { key: string }): RegisteredModel => ({
  modelIdentifier: over.key,
  displayName: over.key,
  description: null,
  providerKey: 'anthropic',
  providerName: 'Anthropic',
  contextWindow: 200_000,
  maxOutputTokens: 8_000,
  supportsVision: false,
  supportsTools: false,
  supportsReasoning: false,
  supportsStructuredOutput: false,
  speed: 'balanced',
  costTier: 'standard',
  inputCostPerMillion: 3,
  outputCostPerMillion: 15,
  bestFor: [],
  routingPriority: 0,
  sortOrder: 0,
  isConfigured: true,
  isDevelopmentMock: false,
  ...over,
});

const limits = (allowedModelKeys: string[]): PlanLimits =>
  ({
    aiUnitsPerMonth: 100,
    deepResearchPerMonth: 1,
    buildProjectsMax: 1,
    imageGenerationsPerMonth: 1,
    videoGenerationsPerMonth: 0,
    fileUploadMaxMb: 10,
    storageMaxGb: 1,
    workspaceMembersMax: 1,
    mcpServersMax: 1,
    concurrentJobsMax: 1,
    allowedModelKeys,
    features: [],
  }) as PlanLimits;

describe('selectableModels', () => {
  it('excludes models whose provider has no credential', () => {
    const result = selectableModels(
      [model({ key: 'yes' }), model({ key: 'no', isConfigured: false })],
      undefined,
    );
    expect(result.map((m) => m.key)).toEqual(['yes']);
  });

  it('treats an empty allowlist as "every enabled model"', () => {
    const result = selectableModels([model({ key: 'a' }), model({ key: 'b' })], limits([]));
    expect(result).toHaveLength(2);
  });

  it('enforces a non-empty plan allowlist', () => {
    const result = selectableModels(
      [model({ key: 'cheap' }), model({ key: 'premium' })],
      limits(['cheap']),
    );
    expect(result.map((m) => m.key)).toEqual(['cheap']);
  });

  /**
   * Regression: a plan allowlist naturally names only real models. Gating the
   * development mock behind it left a developer with zero selectable models, so
   * Chat reported itself unconfigured even though the mock was available.
   */
  it('exempts the development mock from plan gating', () => {
    const result = selectableModels(
      [
        model({ key: 'real', isConfigured: false }),
        model({ key: 'dev-echo-1', isDevelopmentMock: true }),
      ],
      limits(['claude-haiku-4-5', 'gpt-5-mini']),
    );
    expect(result.map((m) => m.key)).toEqual(['dev-echo-1']);
  });

  it('keeps real models alongside the mock when both qualify', () => {
    const result = selectableModels(
      [model({ key: 'real' }), model({ key: 'dev-echo-1', isDevelopmentMock: true })],
      limits([]),
    );
    expect(result).toHaveLength(2);
  });
});

describe('groupByProvider', () => {
  it('groups while preserving input order', () => {
    const groups = groupByProvider([
      model({ key: 'a1', providerKey: 'anthropic', providerName: 'Anthropic' }),
      model({ key: 'o1', providerKey: 'openai', providerName: 'OpenAI' }),
      model({ key: 'a2', providerKey: 'anthropic', providerName: 'Anthropic' }),
    ]);

    expect(groups.map((g) => g.providerKey)).toEqual(['anthropic', 'openai']);
    expect(groups[0]!.models.map((m) => m.key)).toEqual(['a1', 'a2']);
    expect(groups[1]!.models.map((m) => m.key)).toEqual(['o1']);
  });

  it('returns nothing for an empty registry', () => {
    expect(groupByProvider([])).toEqual([]);
  });
});
