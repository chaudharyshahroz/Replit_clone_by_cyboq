/**
 * Deciding what a Whop membership means for a workspace.
 *
 * The two judgements reconciliation makes, separated from the reading and
 * writing around them: is this membership ours, and does the subscription
 * already match it. Both are places where being wrong is quiet — the first
 * would attach a stranger's purchase to the wrong account, the second would
 * hand out a fresh month of credits every time someone opened a page.
 */
import { describe, expect, it } from 'vitest';
import { belongsToWorkspace, isUnchanged, type ExistingSubscription } from '../reconcile';

const sessions = new Map([['ch_ours', 'pro']]);

const membership = {
  id: 'mem_1',
  renewalPeriodEnd: new Date('2026-09-16T05:00:00.000Z'),
  cancelAtPeriodEnd: false,
};

describe('recognising a membership as this workspace’s', () => {
  it('matches a checkout session Reklu minted', () => {
    expect(
      belongsToWorkspace({ checkoutConfigurationId: 'ch_ours', metadata: {} }, 'wsp_1', sessions),
    ).toBe(true);
  });

  /* The path that recovers a purchase made before sessions were recorded. */
  it('falls back to the workspace in the metadata', () => {
    expect(
      belongsToWorkspace(
        { checkoutConfigurationId: undefined, metadata: { workspace_id: 'wsp_1' } },
        'wsp_1',
        sessions,
      ),
    ).toBe(true);
  });

  /*
   * The one that must never be wrong: another customer's purchase, listed
   * alongside ours because both belong to the same Whop company.
   */
  it('refuses a membership belonging to a different workspace', () => {
    expect(
      belongsToWorkspace(
        { checkoutConfigurationId: 'ch_theirs', metadata: { workspace_id: 'wsp_2' } },
        'wsp_1',
        sessions,
      ),
    ).toBe(false);
  });

  it('refuses a membership that identifies nobody', () => {
    expect(
      belongsToWorkspace({ checkoutConfigurationId: undefined, metadata: {} }, 'wsp_1', sessions),
    ).toBe(false);
  });

  it('refuses a session this workspace did not start', () => {
    expect(
      belongsToWorkspace({ checkoutConfigurationId: 'ch_other', metadata: {} }, 'wsp_1', sessions),
    ).toBe(false);
  });
});

describe('deciding whether the subscription needs rewriting', () => {
  const stored: ExistingSubscription = {
    planId: 'plan_pro',
    status: 'active',
    membershipId: 'mem_1',
    periodEnd: new Date('2026-09-16T05:00:00.000Z'),
    cancelAtPeriodEnd: false,
  };

  /*
   * The quota-leak guard. Reconciliation runs on every return from checkout
   * and every button press; rewriting an unchanged subscription resets the
   * usage period and gives away a month of credits each time.
   */
  it('leaves an already-correct subscription alone', () => {
    expect(isUnchanged(stored, membership, 'plan_pro')).toBe(true);
  });

  it('rewrites when the plan differs', () => {
    expect(isUnchanged(stored, membership, 'plan_team')).toBe(false);
  });

  it('rewrites when the membership id has never been stored', () => {
    expect(isUnchanged({ ...stored, membershipId: null }, membership, 'plan_pro')).toBe(false);
  });

  it('rewrites when the renewal date has moved', () => {
    expect(
      isUnchanged(stored, { ...membership, renewalPeriodEnd: new Date('2026-10-16T05:00:00.000Z') }, 'plan_pro'),
    ).toBe(false);
  });

  it('rewrites when the customer has scheduled a cancellation', () => {
    expect(isUnchanged(stored, { ...membership, cancelAtPeriodEnd: true }, 'plan_pro')).toBe(false);
  });

  it('rewrites a subscription that is not active', () => {
    expect(isUnchanged({ ...stored, status: 'canceled' }, membership, 'plan_pro')).toBe(false);
  });

  it('rewrites when there is no subscription at all', () => {
    expect(isUnchanged(undefined, membership, 'plan_pro')).toBe(false);
  });

  /*
   * Whop and Postgres disagree on sub-second precision. Treating that drift as
   * a change would make every check rewrite, which defeats the guard entirely.
   */
  it('ignores sub-second drift in the renewal date', () => {
    expect(
      isUnchanged(
        { ...stored, periodEnd: new Date('2026-09-16T05:00:00.401Z') },
        membership,
        'plan_pro',
      ),
    ).toBe(true);
  });

  /* Whop not sending a renewal date is not evidence the date changed. */
  it('does not rewrite because Whop omitted the renewal date', () => {
    expect(isUnchanged(stored, { ...membership, renewalPeriodEnd: undefined }, 'plan_pro')).toBe(
      true,
    );
  });
});
