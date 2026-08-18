'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPlanPublic } from '@/app/(app)/admin/actions';

interface Plan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyUsd: string;
  readonly isPublic: boolean;
  readonly subscribers: number;
}

export function PlanToggles({ plans }: { plans: readonly Plan[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {plans.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-2.5">
            <span className="text-sm text-text">{plan.name}</span>
            <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              {plan.key}
            </code>
            <span className="text-xs text-text-secondary">${plan.priceMonthlyUsd}/mo</span>
            <span className="text-xs text-text-muted">
              {plan.subscribers} {plan.subscribers === 1 ? 'subscriber' : 'subscribers'}
            </span>

            <label className="ml-auto inline-flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={plan.isPublic}
                disabled={pending}
                onChange={(event) => {
                  const next = event.target.checked;
                  setError(null);
                  startTransition(async () => {
                    const result = await setPlanPublic(plan.id, next);
                    setError(result.error ?? null);
                    router.refresh();
                  });
                }}
                className="h-3.5 w-3.5 rounded border-border"
              />
              Shown in pricing
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
