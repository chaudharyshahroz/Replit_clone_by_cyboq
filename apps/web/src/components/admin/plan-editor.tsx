'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { savePlan, syncPlan } from '@/app/(admin)/admin/actions';

export interface AdminPlan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMonthlyUsd: string;
  readonly billingPeriodDays: number;
  readonly currency: string;
  readonly isPublic: boolean;
  readonly isPurchasable: boolean;
  readonly whopPlanId: string | null;
  readonly whopSyncedAt: string | null;
  readonly whopSyncError: string | null;
  readonly subscribers: number;
}

/**
 * Plans are edited here and mirrored into Whop.
 *
 * The sync state is shown per plan rather than assumed, because a plan that
 * failed to reach Whop looks exactly like one that succeeded until a customer
 * tries to pay for it.
 */
function SyncBadge({ plan }: { plan: AdminPlan }) {
  if (!plan.isPurchasable) {
    return <span className="text-[11px] text-text-muted">Not sold</span>;
  }
  if (plan.whopSyncError) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
        <AlertCircle className="h-3 w-3" strokeWidth={2} />
        Not synced
      </span>
    );
  }
  if (plan.whopSyncedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        In Whop
      </span>
    );
  }
  return <span className="text-[11px] text-warning">Never synced</span>;
}

function PlanCard({ plan }: { plan: AdminPlan }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; notice?: string }>({});

  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [price, setPrice] = useState(plan.priceMonthlyUsd);
  const [period, setPeriod] = useState(String(plan.billingPeriodDays));
  const [isPurchasable, setPurchasable] = useState(plan.isPurchasable);
  const [isPublic, setPublic] = useState(plan.isPublic);

  const run = (work: () => Promise<{ error?: string; notice?: string }>): void => {
    startTransition(async () => setState(await work()));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          savePlan(plan.id, {
            name,
            description,
            priceMonthlyUsd: price,
            billingPeriodDays: Number(period),
            isPurchasable,
            isPublic,
          }),
        );
      }}
      className="rounded-xl border border-border bg-surface/40 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            {plan.key}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {plan.subscribers} subscriber{plan.subscribers === 1 ? '' : 's'}
          </p>
        </div>
        <SyncBadge plan={plan} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-text-secondary">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text"
          />
        </label>

        <label className="text-xs text-text-secondary">
          Price per period (USD)
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text tabular-nums"
          />
        </label>

        <label className="text-xs text-text-secondary sm:col-span-2">
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Shown on the billing page"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text"
          />
        </label>

        <label className="text-xs text-text-secondary">
          Billing period (days)
          <input
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text tabular-nums"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={isPurchasable}
            onChange={(event) => setPurchasable(event.target.checked)}
          />
          Sold on the billing page
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setPublic(event.target.checked)}
          />
          Listed publicly
        </label>
      </div>

      {plan.whopSyncError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-text"
        >
          {plan.whopSyncError}
        </p>
      ) : null}

      {state.error ? (
        <p role="alert" className="mt-4 text-xs text-danger">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="mt-4 text-xs text-success">
          {state.notice}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-on-accent disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
          Save and sync
        </button>

        {/* Retrying a failed sync should not mean re-entering the whole form. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => syncPlan(plan.id))}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-xs text-text-secondary hover:text-text disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          Sync only
        </button>
      </div>

      {plan.whopPlanId ? (
        <p className="mt-3 font-mono text-[11px] text-text-muted">{plan.whopPlanId}</p>
      ) : null}
    </form>
  );
}

export function PlanEditor({ plans }: { plans: readonly AdminPlan[] }) {
  return (
    <div className="grid gap-3">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
}
