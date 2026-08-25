'use server';

import { headers } from 'next/headers';
import { joinWaitlist, type JoinResult } from '@/lib/waitlist';

/**
 * Join the waitlist.
 *
 * The only action in Reklu callable by somebody with no account, which is why
 * everything it does is in one short function that can be read in full.
 */
export async function joinWaitlistAction(
  _previous: JoinResult | null,
  formData: FormData,
): Promise<JoinResult> {
  const requestHeaders = await headers();

  /*
   * For rate limiting only, and never stored. Behind a proxy the socket address
   * is the proxy's, so the forwarded header is what distinguishes callers —
   * spoofable by anyone who wants to, which is the honest limit of a rate limit
   * that costs nothing.
   */
  const caller =
    requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    requestHeaders.get('x-real-ip') ||
    'unknown';

  return joinWaitlist({
    email: String(formData.get('email') ?? ''),
    source: String(formData.get('source') ?? '') || undefined,
    trap: String(formData.get('company') ?? '') || undefined,
    caller,
  });
}
