/**
 * What the free plan may use.
 *
 * `allowedModelKeys` is a spending control: it names the models a plan may
 * reach so that a cheap plan cannot run the expensive ones. A model that costs
 * nothing to serve is not something that control is for — and leaving the free
 * models out of it put Reklu in the position of offering models that are free
 * and then refusing them to the people on the free plan, who are the only ones
 * for whom the distinction mattered.
 */
import { describe, expect, it } from 'vitest';
import { MODELS, PLANS } from '../seed/data';

const free = PLANS.find((plan) => plan.key === 'free');
const zeroCost = MODELS.filter(
  (model) => Number(model.inputCostPerMillion) === 0 && Number(model.outputCostPerMillion) === 0,
);

describe('the free plan', () => {
  it('may use every model that costs nothing', () => {
    const allowed = free?.limits.allowedModelKeys ?? [];

    /* An empty allowlist means everything, which also satisfies this. */
    if (allowed.length === 0) return;

    const refused = zeroCost.filter((model) => !allowed.includes(model.key)).map((m) => m.key);
    expect(refused).toEqual([]);
  });

  it('names models that actually exist', () => {
    // A key with no model behind it silently narrows the plan to fewer models
    // than intended, and nothing reports it.
    const keys = new Set(MODELS.map((model) => model.key));
    const unknown = (free?.limits.allowedModelKeys ?? []).filter((key) => !keys.has(key));

    expect(unknown).toEqual([]);
  });
});
