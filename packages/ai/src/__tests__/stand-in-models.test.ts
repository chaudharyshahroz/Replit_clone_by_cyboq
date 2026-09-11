/**
 * Substituting for a model somebody chose.
 *
 * A build failed on a free OpenRouter model and stopped there, because a
 * deliberate choice was never substituted. The message told the reader to "try
 * Reklu Auto" — to do by hand, on free endpoints that fail constantly, what
 * Reklu could do in the same second.
 *
 * The refusal protected two real things, and these pin both: money, and consent
 * to a provider whose key being configured is not permission to spend it.
 */
import { describe, expect, it } from 'vitest';
import { mayStandInFor } from '../registry';
import type { RegisteredModel } from '../registry';

const model = (
  key: string,
  providerKey: string,
  input = 0,
  output = 0,
): RegisteredModel =>
  ({ key, providerKey, inputCostPerMillion: input, outputCostPerMillion: output }) as RegisteredModel;

const freeOpenRouter = model('openrouter-nemotron-ultra-free', 'openrouter');

describe('what may stand in for a chosen model', () => {
  it('accepts another free model from the same provider', () => {
    expect(mayStandInFor(model('openrouter-inkling-free', 'openrouter'), freeOpenRouter)).toBe(
      true,
    );
  });

  it('refuses a model that costs money when the chosen one was free', () => {
    /* Substituting a paid model spends what nobody agreed to. */
    expect(
      mayStandInFor(model('openrouter-paid', 'openrouter', 3, 15), freeOpenRouter),
    ).toBe(false);
  });

  it('refuses another provider, even a free one', () => {
    /*
     * OpenRouter and B.AI are kept out of automatic routing so that configuring
     * a key never authorises spending it. Choosing one of their models
     * authorises that provider — not Anthropic, and not OpenAI.
     */
    expect(mayStandInFor(model('bai-glm-53-flash', 'bai'), freeOpenRouter)).toBe(false);
    expect(mayStandInFor(model('gemini-2-5-flash', 'google'), freeOpenRouter)).toBe(false);
  });

  it('refuses the model that just failed', () => {
    expect(mayStandInFor(freeOpenRouter, freeOpenRouter)).toBe(false);
  });

  it('compares prices rather than tier labels', () => {
    /*
     * "economy" holds zero-cost models and paid ones together, so a tier
     * comparison would have let a paid economy model stand in for a free one.
     */
    const chosen = model('cheap', 'openai', 0.15, 0.6);
    expect(mayStandInFor(model('cheaper', 'openai', 0.1, 0.4), chosen)).toBe(true);
    expect(mayStandInFor(model('dearer-output', 'openai', 0.15, 0.9), chosen)).toBe(false);
    expect(mayStandInFor(model('same-price', 'openai', 0.15, 0.6), chosen)).toBe(true);
  });
});
