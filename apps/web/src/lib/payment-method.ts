/**
 * How a payment was made, in the words a customer would recognise.
 *
 * A brand and four digits are all Whop ever tells Reklu, and all that is needed
 * to answer the only question the line exists for: which of my cards was this?
 */
export interface PaymentMethodFields {
  readonly cardBrand: string | null;
  readonly cardLast4: string | null;
  readonly methodLabel: string | null;
}

/**
 * Null rather than a guess when Whop sent no card details.
 *
 * A wallet or a bank transfer has no brand and no last four; inventing
 * "Card ····" to fill the space would describe a payment that did not happen
 * that way. `payment_instrument.display_name` is what covers those.
 */
export function describePaymentMethod(payment: PaymentMethodFields): string | null {
  if (payment.cardBrand && payment.cardLast4) {
    const brand = payment.cardBrand.charAt(0).toUpperCase() + payment.cardBrand.slice(1);
    return `${brand} ···· ${payment.cardLast4}`;
  }
  if (payment.cardLast4) return `Card ···· ${payment.cardLast4}`;
  return payment.methodLabel && payment.methodLabel.length > 0 ? payment.methodLabel : null;
}
