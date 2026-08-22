/**
 * Telling the four causes apart.
 *
 * A customer paying and staying on Free has four quite different causes, and
 * they need four different fixes — a URL in Whop's dashboard, a secret, a bug
 * in this code, or an unsynced plan. Guessing wrong costs another round trip
 * through a real payment, which is how this bug survived two attempts at it.
 *
 * These tests pin the sentences that make the call, because a verdict that
 * points at the wrong cause is worse than no verdict: it sends someone to
 * change a setting that was never wrong.
 */
import { describe, expect, it } from 'vitest';
import { judgeDeliveries, judgeMemberships } from '../diagnostics';
import type { DeliverySummary } from '../delivery-log';

const delivery = (outcome: string, detail = ''): DeliverySummary => ({
  id: `whd_${outcome}${detail.length}`,
  externalId: 'msg_1',
  eventType: 'membership.activated',
  outcome,
  detail,
  workspaceId: null,
  payloadKeys: ['id', 'status'],
  metadataKeys: [],
  receivedAt: new Date(),
});

describe('what the delivery log says', () => {
  /* Cause 1: Whop is not calling us. The fix is a URL, not code. */
  it('says Whop is not calling at all when nothing has ever arrived', () => {
    const verdict = judgeDeliveries([]);
    expect(verdict).toContain('No webhook delivery has ever reached');
    expect(verdict).toContain('/api/webhooks/whop');
  });

  /* Cause 2: the secret is wrong. The fix is an env var, not code. */
  it('names the secret when everything is rejected', () => {
    const verdict = judgeDeliveries([delivery('rejected'), delivery('rejected', 'x')]);
    expect(verdict).toContain('WHOP_WEBHOOK_SECRET');
  });

  /* Cause 3: they arrive, verify, and name nobody. This one is code. */
  it('points at the payload when deliveries verify but never apply', () => {
    const verdict = judgeDeliveries([delivery('ignored'), delivery('ignored', 'y')]);
    expect(verdict).toContain('arrive and verify');
    expect(verdict).toContain('could not resolve');
  });

  it('reports success when deliveries are being applied', () => {
    const verdict = judgeDeliveries([delivery('applied'), delivery('ignored')]);
    expect(verdict).toContain('Webhooks are working');
    expect(verdict).toContain('1 of the last 2');
  });

  /*
   * One rejection among working deliveries is not a secret problem — saying so
   * would send someone to rotate a secret that is fine.
   */
  it('does not blame the secret when only some deliveries were rejected', () => {
    const verdict = judgeDeliveries([delivery('applied'), delivery('rejected')]);
    expect(verdict).not.toContain('WHOP_WEBHOOK_SECRET');
  });
});

const diagnosis = (resolved: string | undefined) => ({
  membershipId: 'mem_1',
  status: 'active',
  whopPlanId: 'plan_1',
  checkoutSessionId: 'ch_1',
  metadataKeys: [],
  resolvedWorkspaceId: resolved,
  resolvedWorkspaceName: resolved ? 'Acme' : undefined,
  resolvedPlanKey: 'pro',
  verdict: '',
});

describe('what Whop’s own records say', () => {
  /* Cause 4, and the sharpest one: the API key is for a different company. */
  it('suspects the wrong company when Whop reports no memberships at all', () => {
    expect(judgeMemberships([])).toContain('different company');
  });

  it('says none can be matched when none resolve', () => {
    expect(judgeMemberships([diagnosis(undefined)])).toContain('None of Whop');
  });

  it('counts the unmatched when only some resolve', () => {
    const verdict = judgeMemberships([diagnosis('wsp_1'), diagnosis(undefined)]);
    expect(verdict).toContain('1 of 2');
  });

  it('confirms when every membership resolves', () => {
    expect(judgeMemberships([diagnosis('wsp_1')])).toContain('Every membership');
  });
});
