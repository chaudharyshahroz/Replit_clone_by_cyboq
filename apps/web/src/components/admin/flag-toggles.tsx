'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setFeatureFlag } from '@/app/(admin)/admin/actions';

interface Flag {
  readonly key: string;
  readonly description: string | null;
  readonly enabled: boolean;
}

export function FlagToggles({ flags }: { flags: readonly Flag[] }) {
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
        {flags.map((flag) => (
          <li key={flag.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-2.5">
            <code className="font-mono text-xs text-text">{flag.key}</code>
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {flag.description ?? '—'}
            </span>
            <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={flag.enabled}
                disabled={pending}
                onChange={(event) => {
                  const next = event.target.checked;
                  setError(null);
                  startTransition(async () => {
                    const result = await setFeatureFlag(flag.key, next);
                    setError(result.error ?? null);
                    router.refresh();
                  });
                }}
                className="h-3.5 w-3.5 rounded border-border"
              />
              {flag.enabled ? 'on' : 'off'}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
