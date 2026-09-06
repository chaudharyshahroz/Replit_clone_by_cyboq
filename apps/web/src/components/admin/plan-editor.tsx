'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { deletePlan, savePlan, syncPlan } from '@/app/(admin)/admin/actions';

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
  readonly priceYearlyUsd: string;
  readonly yearlyEnabled: boolean;
  readonly whopPlanId: string | null;
  readonly whopPlanIdYearly: string | null;
  readonly whopSyncedAt: string | null;
  readonly whopSyncError: string | null;
  readonly subscribers: number;
  readonly aiUnitsPerMonth: number | null;
  readonly imageGenerationsPerMonth: number | null;
  readonly deepResearchPerMonth: number | null;
  readonly workspaceMembersMax: number | null;
  readonly allowedModelKeys: readonly string[];
}

/** A model an administrator can grant a plan access to. */
export interface AdminModel {
  readonly key: string;
  readonly displayName: string;
  readonly costTier: string;
  readonly inputCreditsPerThousand: number;
  readonly outputCreditsPerThousand: number;
}

/**
 * A limit that may be a number or deliberately unlimited.
 *
 * "Unmetered" is a real setting, not a blank field — so it gets its own control
 * rather than being expressed as an empty box, which would be indistinguishable
 * from a value someone forgot to type.
 */
function LimitField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  hint?: string;
}) {
  const unlimited = value === null;

  return (
    <label className="text-xs text-text-secondary">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          value={unlimited ? '' : String(value)}
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange(next === '' ? null : Number(next));
          }}
          disabled={unlimited}
          inputMode="numeric"
          className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm tabular-nums text-text disabled:opacity-40"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-text-muted">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(event) => onChange(event.target.checked ? null : 0)}
          />
          Unlimited
        </label>
      </div>
      {hint ? <span className="mt-1 block text-[0.6875rem] text-text-muted">{hint}</span> : null}
    </label>
  );
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
    return <span className="text-[0.6875rem] text-text-muted">Not sold</span>;
  }
  if (plan.whopSyncError) {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-danger">
        <AlertCircle className="h-3 w-3" strokeWidth={2} />
        Not synced
      </span>
    );
  }
  if (plan.whopSyncedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-success">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        In Whop
      </span>
    );
  }
  return <span className="text-[0.6875rem] text-warning">Never synced</span>;
}

function PlanCard({ plan, models }: { plan: AdminPlan; models: readonly AdminModel[] }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; notice?: string }>({});

  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [price, setPrice] = useState(plan.priceMonthlyUsd);
  const [period, setPeriod] = useState(String(plan.billingPeriodDays));
  const [isPurchasable, setPurchasable] = useState(plan.isPurchasable);
  const [isPublic, setPublic] = useState(plan.isPublic);
  const [yearlyPrice, setYearlyPrice] = useState(plan.priceYearlyUsd);
  const [yearlyEnabled, setYearlyEnabled] = useState(plan.yearlyEnabled);
  const [aiUnits, setAiUnits] = useState(plan.aiUnitsPerMonth);
  const [images, setImages] = useState(plan.imageGenerationsPerMonth);
  const [deepResearch, setDeepResearch] = useState(plan.deepResearchPerMonth);
  const [members, setMembers] = useState(plan.workspaceMembersMax);
  const [allowed, setAllowed] = useState<string[]>([...plan.allowedModelKeys]);

  /*
   * A yearly price shown as a monthly equivalent, because that is how a buyer
   * compares it. Two months free is the usual shape; whatever is entered here,
   * the saving is stated rather than left to be worked out.
   */
  const monthly = Number(price);
  const yearly = Number(yearlyPrice);
  const savingPercent =
    monthly > 0 && yearly > 0 ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;

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
            priceYearlyUsd: yearlyPrice,
            yearlyEnabled,
            billingPeriodDays: Number(period),
            isPurchasable,
            isPublic,
            aiUnitsPerMonth: aiUnits,
            imageGenerationsPerMonth: images,
            deepResearchPerMonth: deepResearch,
            workspaceMembersMax: members,
            allowedModelKeys: allowed,
          }),
        );
      }}
      className="rounded-xl border border-border bg-surface/40 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-text-muted">
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

        <label className="text-xs text-text-secondary">
          Price per year (USD)
          <input
            value={yearlyPrice}
            onChange={(event) => setYearlyPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-text tabular-nums"
          />
          <span className="mt-1 block text-[0.6875rem] text-text-muted">
            {savingPercent > 0
              ? `${savingPercent}% cheaper than paying monthly`
              : 'Set below twelve months to offer a saving'}
          </span>
        </label>
      </div>

      <fieldset className="mt-5 rounded-lg border border-border p-4">
        <legend className="px-1 text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
          What the plan includes
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <LimitField
            label="AI credits per month"
            value={aiUnits}
            onChange={setAiUnits}
            hint="One credit equals $0.01 of variable provider cost."
          />
          <LimitField
            label="Images per month"
            value={images}
            onChange={setImages}
          />
          <LimitField
            label="Deep research runs per month"
            value={deepResearch}
            onChange={setDeepResearch}
          />
          <LimitField
            label="Workspace members"
            value={members}
            onChange={setMembers}
          />
        </div>
      </fieldset>

      <fieldset className="mt-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
          Models
        </legend>
        <p className="text-[0.6875rem] leading-relaxed text-text-muted">
          {allowed.length === 0
            ? 'Every enabled model is available on this plan. Tick models to restrict it to those.'
            : `Restricted to ${allowed.length} model${allowed.length === 1 ? '' : 's'}.`}
        </p>

        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {models.map((entry) => (
            <li key={entry.key}>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={allowed.includes(entry.key)}
                  onChange={(event) =>
                    setAllowed((current) =>
                      event.target.checked
                        ? [...current, entry.key]
                        : current.filter((key) => key !== entry.key),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
                {/* The real charge, from the same weights the meter uses. */}
                <span className="shrink-0 tabular-nums text-text-muted">
                  {entry.inputCreditsPerThousand.toFixed(3)} in /{' '}
                  {entry.outputCreditsPerThousand.toFixed(3)} out cr/1k
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

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
            checked={yearlyEnabled}
            onChange={(event) => setYearlyEnabled(event.target.checked)}
          />
          Offer a yearly option
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

        {/*
          Deletion is refused server-side when anyone is subscribed, and the
          message says to retire the plan instead. Confirmed here because it is
          irreversible for a plan nobody is on.
        */}
        {plan.key === 'free' ? null : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const sure = window.confirm(
                `Delete ${plan.name}? This cannot be undone. Plans with subscribers cannot be deleted.`,
              );
              if (sure) run(() => deletePlan(plan.id));
            }}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </button>
        )}
      </div>

      {plan.whopPlanId ? (
        <p className="mt-3 font-mono text-[0.6875rem] text-text-muted">{plan.whopPlanId}</p>
      ) : null}
    </form>
  );
}

export function PlanEditor({
  plans,
  models,
}: {
  plans: readonly AdminPlan[];
  models: readonly AdminModel[];
}) {
  return (
    <div className="grid gap-3">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} models={models} />
      ))}
    </div>
  );
}
