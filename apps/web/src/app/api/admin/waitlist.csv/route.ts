/**
 * The waitlist as a file.
 *
 * Reklu has no mail provider configured, so it cannot send the invitations
 * itself. Rather than a Send button that does nothing, the addresses come out
 * in the format every mailing tool imports.
 */
import { requireSuperAdmin } from '@/lib/admin';
import { listWaitlist, waitlistCsv } from '@/lib/waitlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  /*
   * The same guard as the page. A route handler is a separate entry point and
   * inherits nothing from the layout that protects the page beside it — this
   * one returns every address on the list, which is the sort of thing that gets
   * left open precisely because the page in front of it was locked.
   */
  await requireSuperAdmin();

  const { entries } = await listWaitlist(100_000);

  return new Response(waitlistCsv(entries), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      /* Personal data: never stored by a proxy or a browser cache. */
      'Cache-Control': 'no-store, private',
    },
  });
}
