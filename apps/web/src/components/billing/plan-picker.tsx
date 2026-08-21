'use client';

import { useState, useTransition } from 'react';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { startCheckoutAction } from '@/app/(app)/settings/billing/actions';
import { WhopCheckout } from './whop-checkout';

export interface PickablePlan {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMonthlyUsd: string;
  readonly priceYearlyUsd: string;
  readonly yearlyEnabled: boolean;
  readonly aiUnitsPerMonth: number | null;
  readonly imageGenerationsPerMonth: number | null;
  readonly deepResearchPerMonth: number | null;
  readonly workspaceMembersMax: number | null;
  readonly allowedModelCount: number;
  readonly totalModelCount: number;
}

type Period = 'monthly' | 'yearly';

/** A checkout that has been minted and is ready for the embedded form. */
interface OpenCheckout {
  readonly planName: string;
  readonly sessionId: string;
  readonly whopPlanId: string;
  readonly returnUrl: string;
}

const number = (value: number): string => value.toLocaleString();

/**
 * What a plan includes, written from its own limits.
 *
 * Derived rather than typed out per plan, so the list can never claim something
 * the plan does not actually grant — the two would drift the first time a limit
 * changed in the admin panel, and the marketing copy is the half nobody
 * remembers to update.
 */
function includedIn(plan: PickablePlan): string[] {
  const lines: string[] = [];

  lines.push(
    plan.aiUnitsPerMonth === null
      ? 'Unlimited AI credits'
      : `${number(plan.aiUnitsPerMonth)} AI credits a month`,
  );

  lines.push(
    plan.allowedModelCount === 0
      ? `All ${plan.totalModelCount} models`
      : `${plan.allowedModelCount} of ${plan.totalModelCount} models`,
  );

  if (plan.deepResearchPerMonth !== 0) {
    lines.push(
      plan.deepResearchPerMonth === null
        ? 'Unlimited deep research'
        : `${number(plan.deepResearchPerMonth)} deep research runs a month`,
    );
  }

  if (plan.imageGenerationsPerMonth !== 0) {
    lines.push(
      plan.imageGenerationsPerMonth === null
        ? 'Unlimited image generation'
        : `${number(plan.imageGenerationsPerMonth)} images a month`,
    );
  }

  lines.push(
    plan.workspaceMembersMax === null
      ? 'Unlimited members'
      : plan.workspaceMembersMax === 1
        ? 'Just you'
        : `Up to ${number(plan.workspaceMembersMax)} members`,
  );

  return lines;
}

/** What a plan costs per month, on the period being shown. */
function monthlyRate(plan: PickablePlan, period: Period): number {
  const yearly = Number(plan.priceYearlyUsd);
  if (period === 'yearly' && plan.yearlyEnabled && yearly > 0) return yearly / 12;
  return Number(plan.priceMonthlyUsd);
}

export function PlanPicker({
  plans,
  currentPlanKey,
  open,
  onClose,
}: {
  readonly plans: readonly PickablePlan[];
  readonly currentPlanKey: string | null;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>('monthly');
  const [checkout, setCheckout] = useState<OpenCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, startCheckout] = useTransition();

  if (!open) return null;

  const close = () => {
    setCheckout(null);
    setError(null);
    onClose();
  };

  /*
   * Buying happens here rather than on another page. The session has to be
   * minted first — it is what carries the workspace and plan through to the
   * webhook — so the button waits on the server before the form can appear.
   */
  const choose = (plan: PickablePlan, yearly: boolean) => {
    setError(null);
    startCheckout(async () => {
      const started = await startCheckoutAction(plan.key, yearly ? 'yearly' : 'monthly');
      if (started.error || !started.sessionId || !started.whopPlanId || !started.returnUrl) {
        setError(started.error ?? 'Could not start checkout. Please try again.');
        return;
      }
      setCheckout({
        planName: plan.name,
        sessionId: started.sessionId,
        whopPlanId: started.whopPlanId,
        returnUrl: started.returnUrl,
      });
    });
  };

  /*
   * The best saving on offer, shown on the toggle. Advertising a discount that
   * no plan actually gives would be a lie told by a badge.
   */
  const bestSaving = Math.max(
    0,
    ...plans.map((plan) => {
      const monthly = Number(plan.priceMonthlyUsd);
      const yearly = Number(plan.priceYearlyUsd);
      if (!plan.yearlyEnabled || monthly <= 0 || yearly <= 0) return 0;
      return Math.round((1 - yearly / (monthly * 12)) * 100);
    }),
  );

  const anyYearly = plans.some((plan) => plan.yearlyEnabled);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-picker-title"
        className="mx-auto w-full max-w-[104ch] rounded-2xl border border-border-strong bg-surface p-6 shadow-2xl shadow-black/60 sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {checkout ? (
              <button
                type="button"
                onClick={() => setCheckout(null)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                All plans
              </button>
            ) : null}
            <h2 id="plan-picker-title" className="display text-2xl text-text">
              {checkout ? checkout.planName : 'Compare plans'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {checkout ? (
          <div className="mt-6">
            <WhopCheckout
              planId={checkout.whopPlanId}
              sessionId={checkout.sessionId}
              returnUrl={checkout.returnUrl}
            />
          </div>
        ) : (
        <>
        {anyYearly ? (
          <div className="mt-6 flex justify-center">
            <div
              role="radiogroup"
              aria-label="Billing period"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1"
            >
              {(['monthly', 'yearly'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={period === value}
                  onClick={() => setPeriod(value)}
                  className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                    period === value
                      ? 'bg-surface text-text'
                      : 'text-text-secondary hover:text-text'
                  }`}
                >
                  {value}
                </button>
              ))}
              {bestSaving > 0 ? (
                <span className="ml-1 rounded-md bg-accent-subtle px-2 py-1 text-xs font-medium text-accent">
                  Save up to {bestSaving}%
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => {
            const current = plan.key === currentPlanKey;
            const rate = monthlyRate(plan, period);
            const showsYearly = period === 'yearly' && plan.yearlyEnabled;

            return (
              <section
                key={plan.key}
                className={`flex flex-col rounded-xl border p-5 ${
                  current ? 'border-border bg-surface/40' : 'border-border-strong bg-surface-raised'
                }`}
              >
                <h3 className="text-sm font-medium text-text">{plan.name}</h3>

                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl text-text tabular-nums">
                    ${rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(2)}
                  </span>
                  <span className="text-sm text-text-muted">/month</span>
                </p>

                {showsYearly ? (
                  <p className="mt-1 text-xs text-text-muted">
                    ${Number(plan.priceYearlyUsd).toFixed(0)} billed yearly
                  </p>
                ) : null}

                {plan.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                    {plan.description}
                  </p>
                ) : null}

                <ul className="mt-4 flex-1 space-y-2">
                  {includedIn(plan).map((line) => (
                    <li key={line} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                        strokeWidth={2.5}
                      />
                      {line}
                    </li>
                  ))}
                </ul>

                {current ? (
                  <p className="mt-5 rounded-lg border border-border px-3 py-2 text-center text-xs text-text-muted">
                    Your current plan
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => choose(plan, showsYearly)}
                    className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
                  >
                    {starting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                    ) : null}
                    Choose {plan.name}
                  </button>
                )}
              </section>
            );
          })}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
        </>
        )}

        <p className="mt-6 text-center text-xs text-text-muted">
          Payment is handled by Whop. Card details are entered on their form and never
          reach Reklu.
        </p>
      </div>
    </div>
  );
}
