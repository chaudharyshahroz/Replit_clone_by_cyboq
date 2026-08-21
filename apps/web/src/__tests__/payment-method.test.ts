/**
 * What a payment is described as on the billing page.
 *
 * The rule is that Reklu shows what Whop told it and nothing else. A masked
 * card rendered for a payment that had no card would be a fabrication in the
 * one place a customer goes to check what they were charged.
 */
import { describe, expect, it } from 'vitest';
import { describePaymentMethod } from '@/lib/payment-method';

const none = { cardBrand: null, cardLast4: null, methodLabel: null };

describe('describePaymentMethod', () => {
  it('names the brand and the last four', () => {
    expect(describePaymentMethod({ ...none, cardBrand: 'mastercard', cardLast4: '4242' })).toBe(
      'Mastercard ···· 4242',
    );
  });

  it('capitalises the brand as Whop sends it lowercase', () => {
    expect(describePaymentMethod({ ...none, cardBrand: 'visa', cardLast4: '1111' })).toBe(
      'Visa ···· 1111',
    );
  });

  it('still shows the digits when the brand is missing', () => {
    expect(describePaymentMethod({ ...none, cardLast4: '4242' })).toBe('Card ···· 4242');
  });

  /* A wallet has a name and no digits. Its name is the honest description. */
  it('uses the wallet name when there is no card', () => {
    expect(describePaymentMethod({ ...none, methodLabel: 'Cash App Pay' })).toBe('Cash App Pay');
  });

  /*
   * The important one: nothing known means nothing shown. Returning a
   * placeholder here would put an invented card on the billing page.
   */
  it('describes nothing when Whop sent nothing', () => {
    expect(describePaymentMethod(none)).toBeNull();
  });

  it('does not treat an empty label as a method', () => {
    expect(describePaymentMethod({ ...none, methodLabel: '' })).toBeNull();
  });

  /* A brand with no digits identifies no particular card, so it is not enough. */
  it('does not claim a card from a brand alone', () => {
    expect(describePaymentMethod({ ...none, cardBrand: 'visa' })).toBeNull();
  });
});
