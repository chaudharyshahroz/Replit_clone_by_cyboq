import { describe, expect, it } from 'vitest';
import {
  autoSelect,
  classify,
  estimateTokens,
  NoEligibleModelError,
  route,
  score,
} from '../router';
import type { RegisteredModel } from '../registry';
import type { ModelMessage } from '../types';

const model = (over: Partial<RegisteredModel> & { key: string }): RegisteredModel => ({
  modelIdentifier: over.key,
  displayName: over.key,
  description: null,
  providerKey: 'test',
  providerName: 'Test',
  contextWindow: 200_000,
  maxOutputTokens: 8_000,
  supportsVision: false,
  supportsTools: false,
  supportsReasoning: false,
  supportsStructuredOutput: true,
  speed: 'balanced',
  costTier: 'standard',
  inputCostPerMillion: 3,
  outputCostPerMillion: 15,
  bestFor: [],
  routingPriority: 50,
  sortOrder: 0,
  isConfigured: true,
  isDevelopmentMock: false,
  ...over,
});

/** A registry resembling the seeded one. */
const FLEET: RegisteredModel[] = [
  model({
    key: 'opus',
    costTier: 'premium',
    speed: 'slow',
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    bestFor: ['reasoning', 'coding', 'analysis', 'agent'],
    routingPriority: 100,
  }),
  model({
    key: 'sonnet',
    costTier: 'standard',
    speed: 'balanced',
    supportsReasoning: true,
    supportsVision: true,
    supportsTools: true,
    bestFor: ['general', 'coding', 'writing', 'research'],
    routingPriority: 90,
  }),
  model({
    key: 'haiku',
    costTier: 'economy',
    speed: 'fast',
    supportsVision: true,
    supportsTools: true,
    bestFor: ['quick', 'classification', 'summarization'],
    routingPriority: 60,
  }),
  model({
    key: 'gemini-flash',
    costTier: 'economy',
    speed: 'fast',
    contextWindow: 1_048_576,
    supportsVision: true,
    bestFor: ['quick', 'long-context', 'vision', 'summarization'],
    routingPriority: 50,
  }),
  model({
    key: 'gemini-pro',
    costTier: 'standard',
    contextWindow: 1_048_576,
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    bestFor: ['long-context', 'vision', 'document-analysis', 'research'],
    routingPriority: 85,
  }),
];

const userText = (text: string): ModelMessage[] => [
  { role: 'user', content: [{ type: 'text', text }] },
];

describe('classify', () => {
  it('recognises a trivial greeting as quick', () => {
    expect(classify({ messages: userText('hi') }).intent).toBe('quick');
  });

  it('recognises a coding task', () => {
    const profile = classify({
      messages: userText('Refactor this TypeScript function so the bug in the API handler goes away'),
    });
    expect(profile.intent).toBe('coding');
    expect(profile.complexity).toBeGreaterThanOrEqual(0.7);
  });

  it('recognises a reasoning task', () => {
    expect(
      classify({ messages: userText('Analyse the trade-offs and prove which strategy wins over five years') })
        .intent,
    ).toBe('reasoning');
  });

  it('recognises a research task', () => {
    expect(
      classify({ messages: userText('Research the market for AI customer support and cite your sources') })
        .intent,
    ).toBe('research');
  });

  it('detects vision from an image part regardless of wording', () => {
    const profile = classify({
      messages: [
        { role: 'user', content: [{ type: 'image', image: 'data:image/png;base64,AAA' }] },
      ],
    });
    expect(profile.intent).toBe('vision');
    expect(profile.needsVision).toBe(true);
  });

  it('classifies very large input as long context', () => {
    const profile = classify({ messages: userText('word '.repeat(40_000)) });
    expect(profile.intent).toBe('long_context');
    expect(profile.estimatedInputTokens).toBeGreaterThan(32_000);
  });

  // Vision is a hard capability requirement, so it must win over topic wording.
  it('prefers vision over a coding keyword when an image is present', () => {
    const profile = classify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what does this typescript function do' },
            { type: 'image', image: 'data:image/png;base64,AAA' },
          ],
        },
      ],
    });
    expect(profile.intent).toBe('vision');
  });

  it('raises complexity with conversation depth', () => {
    const shallow = classify({ messages: userText('Explain the plan and evaluate it') });
    const deep = classify({
      messages: [
        ...Array.from({ length: 24 }, () => userText('Explain the plan and evaluate it')[0]!),
      ],
    });
    expect(deep.complexity).toBeGreaterThanOrEqual(shallow.complexity);
  });

  it('reports tool need when tools are offered', () => {
    expect(classify({ messages: userText('do it'), hasTools: true }).needsTools).toBe(true);
  });
});

describe('route', () => {
  it('sends a trivial request to a cheap fast model, not the premium one', () => {
    const decision = autoSelect({ messages: userText('hi'), candidates: FLEET });
    expect(['haiku', 'gemini-flash']).toContain(decision.model.key);
    expect(decision.model.costTier).toBe('economy');
  });

  it('sends hard reasoning to the premium reasoning model', () => {
    const decision = autoSelect({
      messages: userText(
        'Prove which architecture scales better and analyse the trade-offs in depth, ' +
          'considering consistency, latency and operational burden across regions.',
      ),
      candidates: FLEET,
    });
    expect(decision.model.key).toBe('opus');
  });

  it('sends very large input to a large-context model', () => {
    const decision = autoSelect({ messages: userText('word '.repeat(40_000)), candidates: FLEET });
    expect(decision.model.contextWindow).toBeGreaterThan(500_000);
  });

  // Hard requirements are filters, not penalties.
  it('never selects a model that cannot see an image', () => {
    const blind = FLEET.map((m) => ({ ...m, supportsVision: false }));
    const sighted = model({ key: 'sighted', supportsVision: true, bestFor: ['vision'] });

    const decision = autoSelect({
      messages: [{ role: 'user', content: [{ type: 'image', image: 'data:image/png;base64,A' }] }],
      candidates: [...blind, sighted],
    });
    expect(decision.model.key).toBe('sighted');
  });

  it('never selects a model without tool support when tools are required', () => {
    const decision = autoSelect({
      messages: userText('search my CRM'),
      hasTools: true,
      candidates: FLEET,
    });
    expect(decision.model.supportsTools).toBe(true);
  });

  it('throws rather than silently degrading when nothing satisfies the requirement', () => {
    const blind = FLEET.map((m) => ({ ...m, supportsVision: false }));
    expect(() =>
      autoSelect({
        messages: [{ role: 'user', content: [{ type: 'image', image: 'x' }] }],
        candidates: blind,
      }),
    ).toThrow(NoEligibleModelError);
  });

  it('ignores models whose provider is not configured', () => {
    const decision = autoSelect({
      messages: userText('hi'),
      candidates: [
        model({ key: 'unconfigured', costTier: 'economy', bestFor: ['quick'], isConfigured: false }),
        model({ key: 'configured', costTier: 'economy', bestFor: ['quick'] }),
      ],
    });
    expect(decision.model.key).toBe('configured');
  });

  it('falls back to the development mock only when nothing real is configured', () => {
    const decision = autoSelect({
      messages: userText('hello'),
      candidates: [
        model({ key: 'real', isConfigured: false }),
        model({ key: 'dev-echo-1', isDevelopmentMock: true }),
      ],
    });
    expect(decision.model.isDevelopmentMock).toBe(true);
    expect(decision.reason).toMatch(/no ai provider is configured/i);
  });

  it('prefers a real model over the mock when one is configured', () => {
    const decision = autoSelect({
      messages: userText('hello'),
      candidates: [
        model({ key: 'real', costTier: 'economy', bestFor: ['quick'] }),
        model({ key: 'dev-echo-1', isDevelopmentMock: true }),
      ],
    });
    expect(decision.model.key).toBe('real');
  });

  it('always returns an explanation naming the model', () => {
    const decision = autoSelect({ messages: userText('hi'), candidates: FLEET });
    expect(decision.reason).toContain(decision.model.displayName);
    expect(decision.reason.length).toBeGreaterThan(15);
  });

  it('offers alternatives without repeating the winner', () => {
    const decision = autoSelect({ messages: userText('hi'), candidates: FLEET });
    expect(decision.alternatives).not.toContainEqual(decision.model);
    expect(decision.alternatives.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same input', () => {
    const run = () => autoSelect({ messages: userText('Refactor this python class'), candidates: FLEET }).model.key;
    expect(new Set([run(), run(), run()]).size).toBe(1);
  });
});

describe('score', () => {
  it('penalizes a model whose context window cannot fit the request', () => {
    const profile = classify({ messages: userText('word '.repeat(20_000)) });
    const tight = model({ key: 'tight', contextWindow: 8_000 });
    const roomy = model({ key: 'roomy', contextWindow: 1_000_000 });
    expect(score(roomy, profile)).toBeGreaterThan(score(tight, profile));
  });

  it('penalizes reasoning models on trivial work and rewards them on hard work', () => {
    const trivial = classify({ messages: userText('hi') });
    const hard = classify({
      messages: userText('Derive and prove the optimal strategy, analysing every trade-off carefully.'),
    });
    const reasoner = model({ key: 'r', supportsReasoning: true });
    const plain = model({ key: 'p', supportsReasoning: false });

    expect(score(reasoner, trivial)).toBeLessThan(score(plain, trivial));
    expect(score(reasoner, hard)).toBeGreaterThan(score(plain, hard));
  });
});

describe('estimateTokens', () => {
  it('scales with length and is never zero for non-empty text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(4000))).toBe(1000);
  });
});

describe('route (direct)', () => {
  it('accepts a pre-computed profile', () => {
    const profile = classify({ messages: userText('hi') });
    expect(route({ profile, candidates: FLEET }).model).toBeDefined();
  });
});
