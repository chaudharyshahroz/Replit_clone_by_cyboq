import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { billingConfig, reconcileWorkspaceBilling, renewalState } from '@reklu/billing';
import { aiModels, db, payments as paymentsTable, plans, subscriptions } from '@reklu/database';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { getAppContext } from '@/lib/auth-context';
import { describePaymentMethod } from '@/lib/payment-method';
import { UpgradeButton } from '@/components/billing/upgrade-button';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspace } = await getAppContext();
  const { status } = await searchParams;

  /*
   * Returning from checkout is the moment to check, not to promise.
   *
   * This page used to say the plan would update "as soon as Whop confirms it",
   * which was a guess dressed as a fact — if the webhook never arrived, it
   * never updated, and the page went on saying Free under a success banner.
   * Asking Whop directly here makes the common case need no webhook at all.
   */
  const checked =
    status === 'success' ? await reconcileWorkspaceBilling(workspace.workspaceId) : undefined;

  const config = billingConfig();
  const renewal = await renewalState(workspace.workspaceId);

  const [current] = await db
    .select({
      key: plans.key,
      name: plans.name,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.workspaceId, workspace.workspaceId))
    .limit(1);

  /*
   * Prices come from the plans table, not from constants in this file. They
   * have to match what is configured in Whop — Reklu displays the price but
   * Whop is what actually charges, so a mismatch here would advertise one
   * number and take another.
   */
  /*
   * Whatever an administrator has marked purchasable — not a hard-coded pair.
   * Adding a tier in the admin panel makes it appear here with no deploy.
   */
  const purchasable = await db
    .select({
      key: plans.key,
      name: plans.name,
      description: plans.description,
      priceMonthlyUsd: plans.priceMonthlyUsd,
      priceYearlyUsd: plans.priceYearlyUsd,
      yearlyEnabled: plans.yearlyEnabled,
      billingPeriodDays: plans.billingPeriodDays,
      currency: plans.currency,
      whopPlanId: plans.whopPlanId,
      whopPlanIdYearly: plans.whopPlanIdYearly,
      limits: plans.limits,
    })
    .from(plans)
    .where(eq(plans.isPurchasable, true))
    .orderBy(asc(plans.priceMonthlyUsd));

  /* How many models exist, so a plan can say "all of them" truthfully. */
  const [modelCount] = await db
    .select({ total: sql<number>`count(*)` })
    .from(aiModels)
    .where(eq(aiModels.enabled, true));
  const totalModels = Number(modelCount?.total ?? 0);

  /* What has actually been charged, from the payments the webhook recorded. */
  const payments = await db
    .select({
      id: paymentsTable.id,
      amountUsd: paymentsTable.amountUsd,
      createdAt: paymentsTable.createdAt,
      planName: plans.name,
      cardBrand: paymentsTable.cardBrand,
      cardLast4: paymentsTable.cardLast4,
      methodLabel: paymentsTable.paymentMethodLabel,
    })
    .from(paymentsTable)
    .leftJoin(plans, eq(paymentsTable.planId, plans.id))
    .where(eq(paymentsTable.workspaceId, workspace.workspaceId))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(20);

  /* The most recent payment that named a method is the card now on file. */
  const method = payments.map(describePaymentMethod).find((value) => value !== null) ?? null;

  const price = current ? Number(current.priceMonthlyUsd) : 0;

  /* What the subscription is doing, in one word, only where it means something. */
  const stateLabel =
    current?.status === 'canceled'
      ? 'Ending'
      : renewal.autoRenews
        ? 'Active'
        : current
          ? 'Current'
          : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <CreditCard className="h-6 w-6 text-accent" strokeWidth={1.5} />
          Billing
        </h1>
      </header>

      {/*
        Shown only when the purchase has not landed. The plan card below is the
        confirmation when it has — a success banner restating what the card
        already says is noise on the page someone checks when worried.
      */}
      {checked && checked.outcome !== 'applied' ? (
        <p
          role="status"
          className="mt-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-text"
        >
          Payment received, but your plan has not been applied yet.{' '}
          {checked.detail ??
            'Reklu is still waiting for Whop to confirm the purchase. This page checks again each time you open it.'}
        </p>
      ) : null}

      {/* ---- Current plan --------------------------------------------------- */}
      <section className="mt-6 rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium text-text">Current plan</p>
          {/*
            shrink-0 and no wrapping: this link broke onto two lines against the
            plan name, which made the card look broken on the page a customer
            opens when they are already unsure whether their payment worked.
          */}
          <Link
            href="/settings/usage"
            className="shrink-0 whitespace-nowrap text-xs text-accent hover:underline"
          >
            View usage
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="display text-2xl text-text">{current?.name ?? 'Free'}</span>
          {price > 0 ? (
            <span className="text-sm text-text-muted tabular-nums">
              ${price % 1 === 0 ? price.toFixed(0) : price.toFixed(2)} / month
            </span>
          ) : null}
          {stateLabel ? (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs ${
                current?.status === 'canceled'
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-success/40 bg-success/10 text-success'
              }`}
            >
              {stateLabel}
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-sm text-text-secondary">
          {current?.status === 'canceled'
            ? `Ends ${
                current.periodEnd ? new Date(current.periodEnd).toLocaleDateString() : 'at the end of the period'
              }`
            : current?.periodEnd
              ? `${renewal.autoRenews ? 'Renews automatically on' : 'Period ends'} ${new Date(
                  current.periodEnd,
                ).toLocaleDateString()}`
              : 'No renewal date'}
        </p>

        {/*
          Said only where it is true. A paid membership renews on Whop with the
          card already on file; a free plan renews nothing, and putting the line
          on every plan would make it worthless on the one where it matters.
        */}
        {renewal.autoRenews ? (
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Charged to the card on file — nothing to re-enter. Cancel any time from Whop.
          </p>
        ) : null}
      </section>

      {/* ---- Change plan ---------------------------------------------------- */}
      {!config.available ? (
        <section className="mt-4 rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-sm font-medium text-text">Payments are not set up</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{config.detail}</p>
        </section>
      ) : (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-text">Change plan</h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-text-secondary">
            Compare what each plan includes, monthly or yearly.
          </p>
          <div className="mt-3">
            <UpgradeButton
              currentPlanKey={current?.key ?? null}
              plans={purchasable.map((plan) => ({
                key: plan.key,
                name: plan.name,
                description: plan.description,
                priceMonthlyUsd: plan.priceMonthlyUsd,
                priceYearlyUsd: plan.priceYearlyUsd,
                yearlyEnabled: plan.yearlyEnabled,
                aiUnitsPerMonth: plan.limits.aiUnitsPerMonth,
                imageGenerationsPerMonth: plan.limits.imageGenerationsPerMonth,
                deepResearchPerMonth: plan.limits.deepResearchPerMonth,
                workspaceMembersMax: plan.limits.workspaceMembersMax,
                allowedModelCount: plan.limits.allowedModelKeys.length,
                totalModelCount: totalModels,
              }))}
            />
          </div>
        </section>
      )}

      {/* ---- Payments ------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-text">Payments</h2>
        {payments.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 px-5 py-6 text-sm text-text-secondary">
            No payments yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/40">
            {payments.map((payment) => {
              const paidWith = describePaymentMethod(payment);
              return (
                <li key={payment.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text">
                      {payment.planName ?? 'Payment'}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-text-muted">
                      {new Date(payment.createdAt).toLocaleDateString()}
                      {paidWith ? ` · ${paidWith}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-text">
                    ${Number(payment.amountUsd).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Payment method -------------------------------------------------- */}
      <section className="mt-8 rounded-xl border border-border bg-surface/40 p-5">
        <h2 className="text-sm font-medium text-text">Payment method</h2>

        {/*
          The brand and last four are all Whop ever tells Reklu, and all that is
          needed to recognise a card. Shown only when a payment actually carried
          them — a masked card invented for the layout would be a fabrication.
        */}
        {method ? (
          <p className="mt-3 flex items-center gap-2.5 text-sm text-text">
            <CreditCard className="h-4 w-4 shrink-0 text-text-secondary" strokeWidth={1.5} />
            {method}
          </p>
        ) : null}

        <p className="mt-3 max-w-lg text-sm leading-relaxed text-text-secondary">
          Cards are held by Whop, not by Reklu — they are entered on Whop&rsquo;s form and
          never reach us. Change or remove a card, or cancel a subscription, from your
          Whop account.
        </p>
        <a
          href={renewal.manageUrl ?? 'https://whop.com/orders'}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          Manage on Whop
        </a>
      </section>
    </div>
  );
}
