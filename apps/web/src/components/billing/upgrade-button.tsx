'use client';

import { useState } from 'react';
import { PlanPicker, type PickablePlan } from './plan-picker';

/**
 * Opens the plan comparison.
 *
 * A separate client component so the billing page itself stays a server
 * component — it reads plans, quota and the current subscription, none of which
 * belongs in the browser.
 */
export function UpgradeButton({
  plans,
  currentPlanKey,
  label = 'Compare plans',
}: {
  readonly plans: readonly PickablePlan[];
  readonly currentPlanKey: string | null;
  readonly label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
      >
        {label}
      </button>

      <PlanPicker
        plans={plans}
        currentPlanKey={currentPlanKey}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
