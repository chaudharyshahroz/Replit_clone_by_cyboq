import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Gauge } from 'lucide-react';
import { checkQuota } from '@reklu/ai';
import { db, plans, subscriptions, usageLedger } from '@reklu/database';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Usage' };
export const dynamic = 'force-dynamic';

/** What each kind of work is called, in the words a reader would use. */
const KIND_LABELS: Record<string, string> = {
  chat: 'Chat',
  research: 'Research',
  build: 'Build',
  image: 'Images',
  video: 'Video',
  agent: 'Agents',
  embedding: 'Indexing',
};

export default async function UsagePage() {
  const { workspace } = await getAppContext();

  const [quota, current, byKind] = await Promise.all([
    checkQuota(workspace.workspaceId),
    db
      .select({ name: plans.name, periodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, workspace.workspaceId))
      .limit(1),
    /*
     * Grouped by what the credits were spent on. A single "you have used 140 of
     * 200" tells nobody what to change; the breakdown is the part that lets
     * someone decide whether to cut back or upgrade.
     */
    db
      .select({
        kind: usageLedger.kind,
        units: sql<number>`sum(${usageLedger.billableUnits})`,
        requests: sql<number>`count(*)`,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.workspaceId, workspace.workspaceId),
          gte(usageLedger.periodStart, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        ),
      )
      .groupBy(usageLedger.kind)
      .orderBy(desc(sql`sum(${usageLedger.billableUnits})`)),
  ]);

  const plan = current[0];
  const used = quota ? Math.round(quota.used) : 0;
  const limit = quota?.limit ?? null;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const percent = limit === null ? 0 : Math.min(100, (used / limit) * 100);

  return (
    <div className="mx-auto max-w-[86ch] px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <Gauge className="h-6 w-6 text-accent" strokeWidth={1.5} />
          Usage
        </h1>
      </header>

      <section className="mt-8 rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-text">AI credits this period</h2>
          <p className="text-sm tabular-nums text-text-muted">
            {limit === null ? `${used} used · unmetered` : `${used} of ${limit}`}
          </p>
        </div>

        {limit !== null ? (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
              <div
                className={`h-full ${quota?.exceeded ? 'bg-warning' : 'bg-accent'}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              {quota?.exceeded
                ? 'You have used everything included this period.'
                : `${remaining} credits left`}
              {quota ? ` · resets ${new Date(quota.periodEnd).toLocaleDateString()}` : ''}
            </p>
          </>
        ) : null}

        <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
          On {plan?.name ?? 'Free'}. One credit is 1,000 tokens on a standard model;
          faster models cost less and the most capable cost more.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-text">Where it went</h2>
        {byKind.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
            Nothing used yet this period.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface/40">
            {byKind.map((row) => (
              <li key={row.kind} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="text-sm text-text">{KIND_LABELS[row.kind] ?? row.kind}</span>
                <span className="text-xs tabular-nums text-text-muted">
                  {Math.round(Number(row.units))} credits · {Number(row.requests)} requests
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Spec §25: a feature that does not exist says so, rather than offering a
        control that cannot work. Top-ups need a one-off purchase flow and a
        credit balance separate from the plan's monthly allowance — neither is
        built, and a button here would take money for something that would not
        arrive.
      */}
      <section className="mt-6 rounded-xl border border-border bg-surface/40 p-5">
        <h2 className="text-sm font-medium text-text">Need more credits?</h2>
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-text-secondary">
          Extra credits on top of a plan are not available yet. For now, moving to a
          larger plan is the way to raise the monthly allowance.
        </p>
        <Link
          href="/settings/billing"
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          See plans
        </Link>
      </section>
    </div>
  );
}
