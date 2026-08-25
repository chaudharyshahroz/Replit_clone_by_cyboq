import type { Metadata } from 'next';
import { waitlistMode } from '@reklu/shared';
import { listWaitlist } from '@/lib/waitlist';

export const metadata: Metadata = { title: 'Admin · Waitlist' };
export const dynamic = 'force-dynamic';

/**
 * Who is waiting.
 *
 * Read-only, deliberately. The one destructive thing this page could offer —
 * removing somebody — is also the one thing that cannot be undone, and there is
 * no reason to do it from here before the invitations have even gone out.
 */
export default async function AdminWaitlistPage() {
  const { entries, total, invited, thisWeek } = await listWaitlist();
  const enabled = waitlistMode();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Waiting', total],
          ['Joined this week', thisWeek],
          ['Invited', invited],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-surface/40 p-4">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="mt-1 text-2xl font-medium tabular-nums text-text">{value}</p>
          </div>
        ))}
      </div>

      {/*
        Said plainly, because the difference is invisible from this page and
        decides whether anybody can still sign up.
      */}
      <p className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-xs leading-relaxed text-text-secondary">
        {enabled ? (
          <>
            <strong className="text-text">Waitlist mode is on.</strong> reklu.app shows the signup
            form, and the sign in and create account buttons are hidden. Both routes still work:{' '}
            <code className="text-text">/login</code> and <code className="text-text">/signup</code>{' '}
            are reachable by anyone with the address, which is how you get here.
          </>
        ) : (
          <>
            <strong className="text-text">Waitlist mode is off.</strong> reklu.app shows the normal
            landing page. Set <code className="text-text">WAITLIST_MODE=true</code> to collect
            addresses instead.
          </>
        )}
      </p>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-text">Everyone waiting</h2>
        {/*
          A download rather than a Send button. Reklu has no mail provider
          configured, so it cannot send the invitations itself, and a button
          that looked like it could would be a lie about what happens next.
        */}
        <a
          href="/api/admin/waitlist.csv"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
        >
          Download CSV
        </a>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-muted">
          Nobody has joined yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-surface/60 text-left text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5 font-medium">Invited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 text-text">{entry.email}</td>
                  <td className="px-4 py-2.5 text-text-muted">{entry.source ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-text-secondary">
                    {entry.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {entry.invitedAt ? entry.invitedAt.toISOString().slice(0, 10) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
