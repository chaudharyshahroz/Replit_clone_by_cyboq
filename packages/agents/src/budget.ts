/**
 * Run ceilings (spec §109).
 *
 * An agent decides its own next action, so a broken loop is not a hypothetical
 * — it is the default failure mode. Two ceilings bound it: steps and money.
 *
 * Both are checked **before** a step runs, never after. Discovering the budget
 * is gone once the call has been paid for is not a budget.
 */

/** Money as integer micro-dollars, matching usage accounting (D8). */
export type MicroDollars = number;

export const USD = 1_000_000;

export interface BudgetState {
  readonly maxSteps: number;
  readonly stepsExecuted: number;
  readonly maxCostMicroUsd: MicroDollars;
  readonly spentMicroUsd: MicroDollars;
}

export type BudgetVerdict = 'ok' | 'step_limit' | 'cost_limit';

export interface BudgetCheck {
  readonly verdict: BudgetVerdict;
  readonly allowed: boolean;
  readonly reason: string;
  /** What is left, for the progress display. */
  readonly stepsRemaining: number;
  readonly costRemainingMicroUsd: MicroDollars;
}

/** Parse a decimal-string budget (`"5.00"`) into micro-dollars. */
export function parseBudget(value: string | null | undefined): MicroDollars {
  if (!value) return 0;
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  // Rounded, not truncated: 0.1 in binary floating point is slightly under.
  return Math.round(amount * USD);
}

export function formatBudget(micro: MicroDollars): string {
  return `$${(micro / USD).toFixed(2)}`;
}

/**
 * Whether another step may run.
 *
 * A run that has exactly reached its step limit is done — `stepsExecuted` is a
 * count of completed steps, so `>=` is the correct comparison and `>` would
 * silently grant one extra.
 */
export function checkBudget(state: BudgetState): BudgetCheck {
  const stepsRemaining = Math.max(0, state.maxSteps - state.stepsExecuted);
  const costRemainingMicroUsd = Math.max(0, state.maxCostMicroUsd - state.spentMicroUsd);

  if (state.stepsExecuted >= state.maxSteps) {
    return {
      verdict: 'step_limit',
      allowed: false,
      reason: `This run reached its limit of ${state.maxSteps} steps.`,
      stepsRemaining: 0,
      costRemainingMicroUsd,
    };
  }

  if (state.spentMicroUsd >= state.maxCostMicroUsd) {
    return {
      verdict: 'cost_limit',
      allowed: false,
      reason: `This run reached its budget of ${formatBudget(state.maxCostMicroUsd)}.`,
      stepsRemaining,
      costRemainingMicroUsd: 0,
    };
  }

  return {
    verdict: 'ok',
    allowed: true,
    reason: `${stepsRemaining} steps and ${formatBudget(costRemainingMicroUsd)} remaining.`,
    stepsRemaining,
    costRemainingMicroUsd,
  };
}

/**
 * Ceilings an operator or user may set.
 *
 * Clamped rather than rejected: a user typing 10000 wants "a lot", and failing
 * their request to teach them the maximum helps nobody. The cap is what
 * protects the account.
 */
export const LIMITS = {
  maxStepsCeiling: 100,
  maxCostCeilingMicroUsd: 50 * USD,
  defaultSteps: 40,
  defaultCostMicroUsd: 5 * USD,
} as const;

export function clampSteps(requested: number | undefined): number {
  if (!Number.isFinite(requested ?? NaN)) return LIMITS.defaultSteps;
  return Math.min(Math.max(1, Math.floor(requested!)), LIMITS.maxStepsCeiling);
}

export function clampCost(requestedMicroUsd: number | undefined): MicroDollars {
  if (!Number.isFinite(requestedMicroUsd ?? NaN)) return LIMITS.defaultCostMicroUsd;
  return Math.min(Math.max(0, Math.floor(requestedMicroUsd!)), LIMITS.maxCostCeilingMicroUsd);
}
