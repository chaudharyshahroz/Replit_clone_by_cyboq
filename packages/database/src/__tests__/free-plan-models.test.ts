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

/**
 * Seed data is the source of truth, not the database.
 *
 * A model's identifier was corrected in production with SQL and not here — so
 * the next seed overwrote the correction and restored an identifier the
 * provider had withdrawn. The seed reports success either way, and the models
 * simply stop working again.
 */
describe('the free models', () => {
  const openrouter = MODELS.filter((model) => model.providerKey === 'openrouter');
  const zeroCost = MODELS.filter(
    (model) =>
      Number(model.inputCostPerMillion) === 0 && Number(model.outputCostPerMillion) === 0,
  );

  it('all rank below every paid model', () => {
    /*
     * A way to run at no cost, not the right model for the work. Reklu Auto
     * should reach a free model only when nothing better is configured — so
     * adding a free provider must never change what a paying workspace gets.
     */
    const paid = MODELS.filter((model) => Number(model.inputCostPerMillion) > 0);
    const cheapestPaid = Math.min(...paid.map((model) => model.routingPriority));

    for (const model of zeroCost) {
      expect(model.routingPriority, model.key).toBeLessThan(cheapestPaid);
    }
  });

  it('are all allowed on the free plan', () => {
    /*
     * An allowlist is a spending control, and a model with no price is not
     * something that control is for. Adding a free provider and forgetting the
     * plan is how the models appear in the registry and not in the picker.
     */
    const free = PLANS.find((plan) => plan.key === 'free');
    const allowed = free?.limits.allowedModelKeys ?? [];
    if (allowed.length === 0) return;

    const refused = zeroCost.filter((model) => !allowed.includes(model.key)).map((m) => m.key);
    expect(refused).toEqual([]);
  });

  it('are all on the free tier', () => {
    for (const model of openrouter) {
      expect(model.modelIdentifier, model.key).toMatch(/:free$/);
      expect(Number(model.inputCostPerMillion)).toBe(0);
      expect(Number(model.outputCostPerMillion)).toBe(0);
    }
  });

  it('are named for the model they point at', () => {
    /*
     * `openrouter-deepseek-v3-free` pointed at GLM for a while, because the
     * identifier was replaced and the key was not. A key that names a different
     * model than it serves misleads every person who reads it afterwards.
     */
    for (const model of openrouter) {
      const slug = model.modelIdentifier.split('/')[1]?.replace(':free', '') ?? '';
      const stem = slug.split('-')[0] ?? '';
      expect(model.key.includes(stem), `${model.key} vs ${model.modelIdentifier}`).toBe(true);
    }
  });

  it('rank below every paid model', () => {
    // A way to run at no cost, not the right model for the work.
    const paid = MODELS.filter((model) => Number(model.inputCostPerMillion) > 0);
    const cheapestPaid = Math.min(...paid.map((model) => model.routingPriority));

    for (const model of openrouter) {
      expect(model.routingPriority, model.key).toBeLessThan(cheapestPaid);
    }
  });
});
