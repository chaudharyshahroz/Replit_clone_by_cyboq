/**
 * The plan comparison.
 *
 * What a plan says it includes has to be what it grants, and the price shown
 * has to be the price charged. Both are derived from the plan's own limits and
 * prices rather than written out, because a hand-written feature list is the
 * half nobody updates when a limit changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPicker, type PickablePlan } from '@/components/billing/plan-picker';

/*
 * The server action is the only part of buying that cannot run in a test — it
 * reaches Whop. Everything either side of it is real: the button, the period
 * the button sends, and the embed rendered from what comes back.
 */
const startCheckoutAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/settings/billing/actions', () => ({ startCheckoutAction }));

/* next/script does nothing useful in jsdom and warns if left alone. */
vi.mock('next/script', () => ({ default: () => null }));

beforeEach(() => {
  startCheckoutAction.mockReset();
  startCheckoutAction.mockResolvedValue({
    sessionId: 'ch_test',
    whopPlanId: 'plan_test',
    returnUrl: 'https://reklu.app/settings/billing?status=success',
  });
});

const pro: PickablePlan = {
  key: 'pro',
  name: 'Pro',
  description: 'For professionals',
  priceMonthlyUsd: '25.00',
  priceYearlyUsd: '250.00',
  yearlyEnabled: true,
  aiUnitsPerMonth: 2_000,
  imageGenerationsPerMonth: 50,
  deepResearchPerMonth: null,
  workspaceMembersMax: 1,
  allowedModelCount: 0,
  totalModelCount: 9,
};

const team: PickablePlan = {
  ...pro,
  key: 'team',
  name: 'Team',
  priceMonthlyUsd: '40.00',
  priceYearlyUsd: '400.00',
  workspaceMembersMax: 10,
  allowedModelCount: 3,
};

const show = (plans: PickablePlan[], currentPlanKey: string | null = 'free') =>
  render(
    <PlanPicker plans={plans} currentPlanKey={currentPlanKey} open onClose={vi.fn()} />,
  );

describe('what a plan includes', () => {
  it('states credits from the plan limits', () => {
    show([pro]);
    expect(screen.getByText('2,000 AI credits a month')).toBeDefined();
  });

  it('says unlimited where a limit is unmetered', () => {
    show([pro]);
    expect(screen.getByText('Unlimited deep research')).toBeDefined();
  });

  /** An empty allow-list means every model, and should say so truthfully. */
  it('counts models honestly', () => {
    show([pro, team]);
    expect(screen.getByText('All 9 models')).toBeDefined();
    expect(screen.getByText('3 of 9 models')).toBeDefined();
  });

  it('omits a feature the plan does not include at all', () => {
    show([{ ...pro, imageGenerationsPerMonth: 0 }]);
    expect(screen.queryByText(/images a month/)).toBeNull();
  });
});

describe('billing period', () => {
  it('shows the monthly price by default', () => {
    show([pro]);
    expect(screen.getByText('$25')).toBeDefined();
  });

  /** Yearly is shown as a monthly rate, because that is how buyers compare. */
  it('shows the yearly rate per month, and the yearly total', async () => {
    const user = userEvent.setup();
    show([pro]);

    await user.click(screen.getByRole('radio', { name: /yearly/i }));

    expect(screen.getByText('$20.83')).toBeDefined();
    expect(screen.getByText('$250 billed yearly')).toBeDefined();
  });

  it('sends the chosen period to checkout', async () => {
    const user = userEvent.setup();
    show([pro]);

    await user.click(screen.getByRole('radio', { name: /yearly/i }));
    await user.click(screen.getByRole('button', { name: /Choose Pro/ }));

    expect(startCheckoutAction).toHaveBeenCalledWith('pro', 'yearly');
  });

  /*
   * A plan with no yearly option must buy monthly even while the yearly toggle
   * is on, or the toggle would charge a rate the plan does not have.
   */
  it('buys monthly for a plan with no yearly option, whatever the toggle says', async () => {
    const user = userEvent.setup();
    show([pro, { ...team, yearlyEnabled: false }]);

    await user.click(screen.getByRole('radio', { name: /yearly/i }));
    await user.click(screen.getByRole('button', { name: /Choose Team/ }));

    expect(startCheckoutAction).toHaveBeenCalledWith('team', 'monthly');
  });

  /** Advertising a discount no plan gives would be a lie told by a badge. */
  it('advertises only a saving that a plan actually offers', () => {
    show([pro]);
    expect(screen.getByText(/Save up to 17%/)).toBeDefined();
  });

  it('offers no period toggle when no plan has a yearly option', () => {
    show([{ ...pro, yearlyEnabled: false }]);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('the current plan', () => {
  it('is marked and not offered for purchase', () => {
    show([pro], 'pro');
    expect(screen.getByText('Your current plan')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Choose Pro/ })).toBeNull();
  });
});

/**
 * Buying happens where the plan was chosen.
 *
 * It used to link to the billing page, which meant deciding in one place and
 * paying in another, and made the billing page carry a checkout branch that had
 * nothing to do with showing a bill.
 */
describe('checkout', () => {
  it('opens the payment form in place, with the session the server minted', async () => {
    const user = userEvent.setup();
    const { container } = show([pro]);

    await user.click(screen.getByRole('button', { name: /Choose Pro/ }));

    const embed = container.querySelector('[data-whop-checkout-session]');
    expect(embed?.getAttribute('data-whop-checkout-session')).toBe('ch_test');
    expect(embed?.getAttribute('data-whop-checkout-plan-id')).toBe('plan_test');
  });

  it('does not navigate away to do it', async () => {
    const user = userEvent.setup();
    show([pro]);

    await user.click(screen.getByRole('button', { name: /Choose Pro/ }));

    expect(screen.queryByRole('link', { name: /Choose Pro/ })).toBeNull();
    expect(
      screen.queryByRole('link', { name: /billing/i }),
    ).toBeNull();
  });

  /*
   * A failure has to say so. Rendering the embed anyway would show a payment
   * form built on a session that was never created.
   */
  it('reports a failure instead of showing a payment form', async () => {
    const user = userEvent.setup();
    startCheckoutAction.mockResolvedValue({ error: 'WHOP_API_KEY is not set.' });
    const { container } = show([pro]);

    await user.click(screen.getByRole('button', { name: /Choose Pro/ }));

    expect(screen.getByRole('alert').textContent).toContain('WHOP_API_KEY is not set.');
    expect(container.querySelector('[data-whop-checkout-session]')).toBeNull();
  });

  /* An incomplete reply is a failure, not a session with blank fields. */
  it('treats a reply with no session as a failure', async () => {
    const user = userEvent.setup();
    startCheckoutAction.mockResolvedValue({ whopPlanId: 'plan_test' });
    const { container } = show([pro]);

    await user.click(screen.getByRole('button', { name: /Choose Pro/ }));

    expect(screen.getByRole('alert')).toBeDefined();
    expect(container.querySelector('[data-whop-checkout-session]')).toBeNull();
  });
});
