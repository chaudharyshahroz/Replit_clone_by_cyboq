/**
 * Cancelling a plan, and believing the answer.
 *
 * Whop accepts a cancellation and applies it after — they publish
 * `membership.cancel_at_period_end_changed` as a webhook, which would be
 * pointless if the change were always finished by the time the response came
 * back. Reading that one response as final told the customer "Whop accepted the
 * request but has not marked the subscription as ending. Please check your Whop
 * account", while the cancellation was going through normally.
 *
 * The rule it must not break in fixing that: never report a cancellation that
 * did not happen, or somebody stops expecting a charge that is still due.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cancelMembership = vi.hoisted(() => vi.fn());
const getMembership = vi.hoisted(() => vi.fn());
const resumeMembership = vi.hoisted(() => vi.fn());
const updated = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('../whop-api', () => ({ cancelMembership, getMembership, resumeMembership }));
vi.mock('../config', () => ({
  billingConfig: () => ({ available: true, apiKey: 'k', detail: '' }),
}));

vi.mock('@reklu/database', () => ({
  subscriptions: {
    whopMembershipId: 'whop_membership_id',
    cancelAtPeriodEnd: 'cancel_at_period_end',
    currentPeriodEnd: 'current_period_end',
    workspaceId: 'workspace_id',
  },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { membershipId: 'mem_abc123', cancelAtPeriodEnd: false, periodEnd: new Date('2026-09-21') },
          ],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

const { cancelWorkspacePlan } = await import('../cancel');

const renewing = {
  id: 'mem_abc123',
  status: 'active',
  cancelAtPeriodEnd: false,
  renewalPeriodEnd: new Date('2026-09-21'),
};
const ending = { ...renewing, cancelAtPeriodEnd: true };

beforeEach(() => {
  cancelMembership.mockReset();
  getMembership.mockReset();
  updated.length = 0;
});

describe('when Whop applies the cancellation a moment later', () => {
  it('asks once more before calling it a failure', async () => {
    cancelMembership.mockResolvedValue({ membership: renewing, failure: undefined });
    getMembership.mockResolvedValue({ membership: ending, failure: undefined });

    const result = await cancelWorkspacePlan('wsp_1');

    expect(getMembership).toHaveBeenCalledWith({ apiKey: 'k', membershipId: 'mem_abc123' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('will not renew');
    // And it is written down, so the page stops offering to cancel again.
    expect(updated[0]).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it('does not ask again when the response already confirmed it', async () => {
    cancelMembership.mockResolvedValue({ membership: ending, failure: undefined });

    const result = await cancelWorkspacePlan('wsp_1');

    expect(getMembership).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe('when it really has not been applied', () => {
  it('still refuses to claim the plan is cancelled', async () => {
    cancelMembership.mockResolvedValue({ membership: renewing, failure: undefined });
    getMembership.mockResolvedValue({ membership: renewing, failure: undefined });

    const result = await cancelWorkspacePlan('wsp_1');

    expect(result.ok).toBe(false);
    expect(updated).toHaveLength(0);
    /* And says what to do, rather than leaving it at "check your account". */
    expect(result.message).toContain('reload this page');
  });

  it('survives the second read failing, without claiming success', async () => {
    cancelMembership.mockResolvedValue({ membership: renewing, failure: undefined });
    getMembership.mockResolvedValue({
      membership: undefined,
      failure: { status: 500, detail: 'Whop is having trouble on their end (500).' },
    });

    const result = await cancelWorkspacePlan('wsp_1');

    expect(result.ok).toBe(false);
    expect(updated).toHaveLength(0);
  });

  it('reports a refused write without reading anything back', async () => {
    cancelMembership.mockResolvedValue({
      membership: undefined,
      failure: { status: 403, detail: 'The API key is not authorized for this.' },
    });

    const result = await cancelWorkspacePlan('wsp_1');

    expect(getMembership).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not authorized');
  });
});
