/**
 * Reading a Whop event.
 *
 * A customer paid for Pro, was charged, and stayed on Free. Nothing errored:
 * the event arrived, named no workspace Reklu recognised, and was ignored
 * exactly as designed. The lesson was not that the ignoring was wrong — it is
 * right, since acting on an event that names no account would change a
 * stranger's plan — but that there was only one way to identify the account,
 * and it depended on Whop echoing back metadata Reklu had asked it to carry.
 *
 * These tests pin the second way: the checkout session id, which Whop stamps
 * on the membership and the payment itself.
 */
import { describe, expect, it } from 'vitest';
import { cardFrom, checkoutSessionIdFrom, workspaceIdFrom } from '../subscription';

describe('finding the workspace in the metadata', () => {
  it('reads the snake_case key Reklu writes', () => {
    expect(workspaceIdFrom({ metadata: { workspace_id: 'wsp_1' } })).toBe('wsp_1');
  });

  it('reads a camelCase key too, in case it comes back transformed', () => {
    expect(workspaceIdFrom({ metadata: { workspaceId: 'wsp_1' } })).toBe('wsp_1');
  });

  it('finds it nested under a checkout session', () => {
    expect(workspaceIdFrom({ checkout_session: { metadata: { workspace_id: 'wsp_9' } } })).toBe(
      'wsp_9',
    );
  });

  /* The prefix is the check: an arbitrary string is not a workspace id. */
  it('ignores a value that is not a workspace id', () => {
    expect(workspaceIdFrom({ metadata: { workspace_id: 'user_1' } })).toBeUndefined();
  });

  /* This is the shape that caused the bug — no metadata came back at all. */
  it('finds nothing when the metadata did not survive', () => {
    expect(workspaceIdFrom({ id: 'mem_1', status: 'active' })).toBeUndefined();
  });
});

describe('finding the checkout session', () => {
  /*
   * The field Whop puts on both a membership and a payment. This is the link
   * that does not depend on Reklu's metadata coming back.
   */
  it('reads checkout_configuration_id from a membership', () => {
    expect(
      checkoutSessionIdFrom({ id: 'mem_1', checkout_configuration_id: 'ch_abc' }),
    ).toBe('ch_abc');
  });

  it('reads it from a payment', () => {
    expect(
      checkoutSessionIdFrom({ id: 'pay_1', checkout_configuration_id: 'ch_abc' }),
    ).toBe('ch_abc');
  });

  it('accepts a camelCase spelling', () => {
    expect(checkoutSessionIdFrom({ checkoutConfigurationId: 'ch_abc' })).toBe('ch_abc');
  });

  it('finds it nested on a checkout session object', () => {
    expect(checkoutSessionIdFrom({ checkout_session: { id: 'ch_abc' } })).toBe('ch_abc');
  });

  /*
   * The prefix matters. A membership id read as a session id would be looked up
   * in the wrong table and silently find nothing, which is the same failure in
   * a new place.
   */
  it('refuses an id that is not a checkout session', () => {
    expect(checkoutSessionIdFrom({ checkout_configuration_id: 'mem_abc' })).toBeUndefined();
  });

  it('finds nothing in an event that carries neither', () => {
    expect(checkoutSessionIdFrom({ id: 'mem_1', status: 'active' })).toBeUndefined();
  });
});

describe('reading the card off a payment', () => {
  it('takes the top-level fields Whop documents', () => {
    expect(cardFrom({ card_brand: 'visa', card_last4: '4242' })).toEqual({
      brand: 'visa',
      last4: '4242',
      label: undefined,
    });
  });

  it('falls back to the payment instrument', () => {
    expect(cardFrom({ payment_instrument: { card: { brand: 'amex', last4: '0005' } } })).toEqual({
      brand: 'amex',
      last4: '0005',
      label: undefined,
    });
  });

  /* A wallet has no card; its display name is what there is to show. */
  it('keeps the wallet name when there is no card', () => {
    expect(cardFrom({ payment_instrument: { display_name: 'Cash App Pay' } })).toEqual({
      brand: undefined,
      last4: undefined,
      label: 'Cash App Pay',
    });
  });

  it('finds nothing on a payment that described no method', () => {
    expect(cardFrom({ id: 'pay_1' })).toEqual({
      brand: undefined,
      last4: undefined,
      label: undefined,
    });
  });
});
