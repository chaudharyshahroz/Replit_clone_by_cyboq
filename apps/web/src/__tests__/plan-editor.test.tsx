/**
 * The plan editor.
 *
 * Plans decide what people are charged and what they get, so the controls have
 * to say what they mean. Two things in particular: "unlimited" is a setting and
 * not an empty box, and a plan with subscribers must not be deletable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const savePlan = vi.fn(async () => ({}));
const syncPlan = vi.fn(async () => ({}));
const deletePlan = vi.fn(async () => ({}));

vi.mock('@/app/(admin)/admin/actions', () => ({
  savePlan: (...args: unknown[]) => savePlan(...(args as [])),
  syncPlan: (...args: unknown[]) => syncPlan(...(args as [])),
  deletePlan: (...args: unknown[]) => deletePlan(...(args as [])),
}));

const { PlanEditor } = await import('@/components/admin/plan-editor');

const models = [
  { key: 'gpt-5', displayName: 'GPT-5', costTier: 'premium', inputCreditsPerThousand: 0.3, outputCreditsPerThousand: 1.5 },
  { key: 'haiku', displayName: 'Haiku 4.5', costTier: 'economy', inputCreditsPerThousand: 0.08, outputCreditsPerThousand: 0.4 },
];

const plan = {
  id: 'pln_1',
  key: 'pro',
  name: 'Pro',
  description: 'For professionals',
  priceMonthlyUsd: '25.00',
  priceYearlyUsd: '250.00',
  yearlyEnabled: true,
  billingPeriodDays: 30,
  currency: 'usd',
  isPublic: true,
  isPurchasable: true,
  whopPlanId: 'plan_abc',
  whopPlanIdYearly: null,
  whopSyncedAt: null,
  whopSyncError: null,
  subscribers: 3,
  aiUnitsPerMonth: 2_000,
  imageGenerationsPerMonth: 50,
  deepResearchPerMonth: null,
  workspaceMembersMax: 5,
  allowedModelKeys: [] as string[],
};

beforeEach(() => vi.clearAllMocks());

describe('limits', () => {
  it('shows a numeric limit as a number', () => {
    render(<PlanEditor plans={[plan]} models={models} />);
    expect(screen.getByDisplayValue('2000')).toBeDefined();
  });

  /**
   * Unmetered is a decision. Shown as an empty box it would be
   * indistinguishable from a value someone forgot to fill in.
   */
  it('shows an unlimited limit as unlimited, not as a blank box', () => {
    render(<PlanEditor plans={[plan]} models={models} />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Unlimited' });
    expect(boxes.some((box) => (box as HTMLInputElement).checked)).toBe(true);
  });

  it('saves the limits along with the price', async () => {
    const user = userEvent.setup();
    render(<PlanEditor plans={[plan]} models={models} />);

    await user.click(screen.getByRole('button', { name: /Save and sync/ }));

    expect(savePlan).toHaveBeenCalledWith(
      'pln_1',
      expect.objectContaining({
        priceMonthlyUsd: '25.00',
        priceYearlyUsd: '250.00',
        yearlyEnabled: true,
        aiUnitsPerMonth: 2_000,
        deepResearchPerMonth: null,
      }),
    );
  });
});

describe('models', () => {
  it('states that an empty list means every model', () => {
    render(<PlanEditor plans={[plan]} models={models} />);
    expect(screen.getByText(/Every enabled model is available/)).toBeDefined();
  });

  /** The number shown must be the number charged. */
  it('shows the credit cost of each model', () => {
    render(<PlanEditor plans={[plan]} models={models} />);
    expect(screen.getByText(/0\.300.*1\.500.*out cr\/1k/)).toBeDefined();
    expect(screen.getByText(/0\.080.*0\.400.*out cr\/1k/)).toBeDefined();
  });

  it('restricts the plan when a model is ticked', async () => {
    const user = userEvent.setup();
    render(<PlanEditor plans={[plan]} models={models} />);

    await user.click(screen.getByRole('checkbox', { name: /GPT-5/ }));
    await user.click(screen.getByRole('button', { name: /Save and sync/ }));

    expect(savePlan).toHaveBeenCalledWith(
      'pln_1',
      expect.objectContaining({ allowedModelKeys: ['gpt-5'] }),
    );
  });
});

describe('yearly pricing', () => {
  it('states the saving rather than leaving it to be worked out', () => {
    render(<PlanEditor plans={[plan]} models={models} />);
    // 250 against 12 × 25 is a sixth off.
    expect(screen.getByText(/17% cheaper than paying monthly/)).toBeDefined();
  });
});

describe('deleting', () => {
  it('does not offer to delete the free plan', () => {
    render(
      <PlanEditor plans={[{ ...plan, key: 'free', name: 'Free' }]} models={models} />,
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('asks before deleting, and does nothing if refused', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<PlanEditor plans={[plan]} models={models} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deletePlan).not.toHaveBeenCalled();
  });
});
