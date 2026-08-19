/**
 * Constrain a post-authentication destination to this origin.
 *
 * Lives outside `actions.ts` because that file is `'use server'`, where every
 * export must be an async server action — a sync helper exported from it fails
 * the build. It is shared rather than duplicated so the sign-in flow and the
 * sign-up page cannot drift into two subtly different definitions of "safe".
 *
 * `next` reaches this from a query string or a form field, so it is attacker
 * controlled. Without the check, a crafted link turns Reklu's own sign-in into
 * a redirect to somewhere else wearing Reklu's domain in the address bar.
 */
export function safeNext(value: FormDataEntryValue | null | undefined): string {
  const next = typeof value === 'string' ? value : '';
  // A protocol-relative `//evil.test` is absolute to a browser despite the
  // leading slash, so both conditions are needed.
  if (!next.startsWith('/') || next.startsWith('//')) return '/chat';
  return next;
}
