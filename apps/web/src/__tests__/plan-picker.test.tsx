/**
 * The plan comparison.
 *
 * What a plan says it includes has to be what it grants, and the price shown
 * has to be the price charged. Both are derived from the plan's own limits and
 * prices rather than written out, because a hand-written feature list is the
 * half nobody updates when a limit changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPicker, type PickablePlan } from '@/components/billing/plan-picker';

/*
 * The server action is the only part of buying that cannot run in a test — it
 * reaches Whop. Everything either side of it is real: the button, the period
 * the button sends, and the embed rendered from what comes back.
 */
const startCheckoutAction = vi.hoisted(() => vi.fn());
const reconcileBillingAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/settings/billing/actions', () => ({
  startCheckoutAction,
  reconcileBillingAction,
}));

/* The picker refreshes the page behind it once a plan lands. */
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

/* next/script does nothing useful in jsdom and warns if left alone. */
vi.mock('next/script', () => ({ default: () => null }));

beforeEach(() => {
  refresh.mockReset();
  reconcileBillingAction.mockReset();
  reconcileBillingAction.mockResolvedValue({ message: 'nothing yet', applied: false });
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

/**
 * Noticing that the payment went through.
 *
 * The form runs in an iframe inside this dialog, and Whop's redirect landing in
 * the top window is not something Reklu controls. When it does not, nothing on
 * this side ever learns the payment happened — which is the shape of the bug a
 * customer hit three times: paid, charged, still on Free.
 */
describe('noticing the purchase complete', () => {
  /*
   * Fake timers have to be installed before the dialog creates its interval,
   * so these use fireEvent rather than userEvent — userEvent drives its own
   * clock and deadlocks against a faked one.
   */
  const withFakeClock = () => {
    vi.useFakeTimers();
  };

  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /** Open the payment form, the way a customer does. */
  const choosePro = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Choose Pro/ }));
    });
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not ask before the payment form is open', async () => {
    withFakeClock();
    show([pro]);

    await tick(20_000);

    expect(reconcileBillingAction).not.toHaveBeenCalled();
  });

  it('asks repeatedly while the customer is paying', async () => {
    withFakeClock();
    show([pro]);
    await choosePro();

    await tick(13_000);

    expect(reconcileBillingAction.mock.calls.length).toBeGreaterThan(1);
  });

  it('confirms and refreshes once the plan lands', async () => {
    withFakeClock();
    show([pro]);
    await choosePro();

    reconcileBillingAction.mockResolvedValue({ message: 'done', applied: true });
    await tick(5_000);

    expect(screen.getByText(/Payment received/)).toBeDefined();
    expect(refresh).toHaveBeenCalled();
  });

  /* Once it has landed there is nothing left to ask about. */
  it('stops asking once the plan has landed', async () => {
    withFakeClock();
    show([pro]);
    await choosePro();

    reconcileBillingAction.mockResolvedValue({ message: 'done', applied: true });
    await tick(5_000);
    const afterApplied = reconcileBillingAction.mock.calls.length;

    await tick(30_000);

    expect(reconcileBillingAction.mock.calls.length).toBe(afterApplied);
  });

  /* An unbounded poller left running in a dialog is a leak, not a feature. */
  it('gives up rather than polling forever', async () => {
    withFakeClock();
    show([pro]);
    await choosePro();

    await tick(10 * 60 * 1000);

    expect(reconcileBillingAction.mock.calls.length).toBeLessThanOrEqual(30);
  });
});
