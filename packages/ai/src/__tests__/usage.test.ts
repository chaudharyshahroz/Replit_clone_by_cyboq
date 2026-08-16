import { describe, expect, it } from 'vitest';
import { billableUnits, costMicros, microsToUsdString } from '../usage';
import type { RegisteredModel } from '../registry';
import type { TokenUsage } from '../types';

const model = (over: Partial<RegisteredModel> = {}): RegisteredModel =>
  ({
    key: 'm',
    modelIdentifier: 'm',
    displayName: 'M',
    description: null,
    providerKey: 'p',
    providerName: 'P',
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
  }) as RegisteredModel;

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  ...over,
});

describe('costMicros', () => {
  it('prices input and output at their own rates', () => {
    // 1M input @ $3 + 1M output @ $15 = $18 = 18,000,000 micros
    const micros = costMicros(model(), usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(micros).toBe(18_000_000);
    expect(microsToUsdString(micros)).toBe('18.000000');
  });

  it('bills reasoning tokens at the output rate', () => {
    const withReasoning = costMicros(model(), usage({ reasoningTokens: 1_000_000 }));
    const withOutput = costMicros(model(), usage({ outputTokens: 1_000_000 }));
    expect(withReasoning).toBe(withOutput);
  });

  it('is zero for an empty call', () => {
    expect(costMicros(model(), usage())).toBe(0);
  });

  // The reason costs are integer micros rather than accumulated floats.
  it('does not drift when summed over many small calls', () => {
    const one = costMicros(model(), usage({ inputTokens: 333, outputTokens: 777 }));
    const summed = Array.from({ length: 100_000 }, () => one).reduce((a, b) => a + b, 0);
    expect(Number.isInteger(summed)).toBe(true);
    expect(summed).toBe(one * 100_000);
  });

  it('scales with the model’s configured rate', () => {
    const cheap = costMicros(
      model({ inputCostPerMillion: 0.25, outputCostPerMillion: 2 }),
      usage({ inputTokens: 1_000_000 }),
    );
    const dear = costMicros(
      model({ inputCostPerMillion: 15, outputCostPerMillion: 75 }),
      usage({ inputTokens: 1_000_000 }),
    );
    expect(dear).toBeGreaterThan(cheap);
  });
});

describe('billableUnits', () => {
  it('weights premium tiers more heavily than economy', () => {
    const tokens = usage({ inputTokens: 10_000, outputTokens: 10_000 });
    const economy = billableUnits(model({ costTier: 'economy' }), tokens);
    const standard = billableUnits(model({ costTier: 'standard' }), tokens);
    const premium = billableUnits(model({ costTier: 'premium' }), tokens);

    expect(economy).toBeLessThan(standard);
    expect(standard).toBeLessThan(premium);
  });

  // The development mock must never consume a customer's quota.
  it('charges nothing for the development mock', () => {
    expect(
      billableUnits(model({ isDevelopmentMock: true }), usage({ inputTokens: 10_000, outputTokens: 10_000 })),
    ).toBe(0);
  });

  it('charges a minimum for a real but tiny call', () => {
    expect(billableUnits(model(), usage({ inputTokens: 1, outputTokens: 1 }))).toBeGreaterThan(0);
  });

  it('grows with token count', () => {
    const small = billableUnits(model(), usage({ inputTokens: 1_000 }));
    const large = billableUnits(model(), usage({ inputTokens: 100_000 }));
    expect(large).toBeGreaterThan(small);
  });
});

describe('microsToUsdString', () => {
  it('renders fixed six-decimal dollars for the numeric column', () => {
    expect(microsToUsdString(0)).toBe('0.000000');
    expect(microsToUsdString(1)).toBe('0.000001');
    expect(microsToUsdString(1_500_000)).toBe('1.500000');
  });
});
