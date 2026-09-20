/**
 * Cancelling when Whop refuses the request.
 *
 * Reklu cancels through Whop's API with a company key. When that key lacks the
 * `membership:cancel` scope, Whop refuses and the dialog showed a red error and
 * nothing else — somebody trying to stop paying with no way to do it, while the
 * page that always works sat three sections further down under "Payment
 * method". Reklu's key needing a scope is not their problem to be stuck behind.
 *
 * The link appears only on failure. Offering it otherwise would be the dark
 * pattern the component exists to avoid: sending someone to another company's
 * site to stop paying, when the decision belongs where the buying happened.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const cancelPlanAction = vi.hoisted(() => vi.fn());
const resumePlanAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/(app)/settings/billing/actions', () => ({
  cancelPlanAction,
  resumePlanAction,
}));

const { CancelPlan } = await import('@/components/billing/cancel-plan');

const MANAGE_URL = 'https://whop.com/billing/manage/mem_abc123';

function renderDialog(manageUrl: string | null = MANAGE_URL) {
  return render(
    <CancelPlan canManage endsAt="9/21/2026" scheduledToEnd={false} manageUrl={manageUrl} />,
  );
}

async function openAndCancel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Cancel plan' }));
  await user.click(screen.getByRole('button', { name: /Yes, cancel it/ }));
}

beforeEach(() => {
  cancelPlanAction.mockReset();
  resumePlanAction.mockReset();
});

describe('when Whop refuses the cancellation', () => {
  it('offers the Whop page, which does not need the scope', async () => {
    cancelPlanAction.mockResolvedValue({
      ok: false,
      message:
        'The API key is not authorized for this. It needs: membership:cancel, member:basic:read, member:email:read.',
    });

    const user = userEvent.setup();
    renderDialog();
    await openAndCancel(user);

    const link = await screen.findByRole('link', { name: /Cancel on Whop instead/ });
    expect(link.getAttribute('href')).toBe(MANAGE_URL);
    // A new tab, and no referrer handed to another company.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('still says what Whop said, rather than replacing it with a link', async () => {
    cancelPlanAction.mockResolvedValue({ ok: false, message: 'Company API key is not authorized.' });

    const user = userEvent.setup();
    renderDialog();
    await openAndCancel(user);

    expect((await screen.findByRole('alert')).textContent).toContain('not authorized');
  });

  it('falls back to the orders page when this membership has no manage URL', async () => {
    cancelPlanAction.mockResolvedValue({ ok: false, message: 'Refused.' });

    const user = userEvent.setup();
    renderDialog(null);
    await openAndCancel(user);

    expect((await screen.findByRole('link', { name: /Cancel on Whop/ })).getAttribute('href')).toBe(
      'https://whop.com/orders',
    );
  });
});

describe('when nothing has gone wrong', () => {
  it('does not offer it before the attempt', () => {
    renderDialog();
    expect(screen.queryByRole('link', { name: /Whop/ })).toBeNull();
  });

  it('does not offer it when the cancellation succeeds', async () => {
    cancelPlanAction.mockResolvedValue({ ok: true, message: 'Your plan ends on 9/21/2026.' });

    const user = userEvent.setup();
    renderDialog();
    await openAndCancel(user);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('9/21/2026'));
    expect(screen.queryByRole('link', { name: /Whop/ })).toBeNull();
  });
});
