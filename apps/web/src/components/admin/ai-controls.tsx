'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setModelEnabled, setProviderEnabled } from '@/app/(admin)/admin/actions';

interface Provider {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly apiKeyEnvVar: string | null;
  readonly enabled: boolean;
  readonly hasKey: boolean;
}

interface Model {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly providerKey: string;
  readonly enabled: boolean;
  readonly providerEnabled: boolean;
  readonly costTier: string;
  readonly inputCostPerMillion: string;
  readonly outputCostPerMillion: string;
  /** Credits charged per 1,000 tokens, from the table the meter uses. */
  readonly creditsPerThousandTokens: number;
  /** Plans that grant access, or empty when every plan does. */
  readonly plans: readonly string[];
}

export function AiControls({
  providers,
  models,
}: {
  providers: readonly Provider[];
  models: readonly Model[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string }>): void => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setError(result.error ?? null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {providers.map((provider) => (
          <li key={provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3.5 py-3">
            <span className="text-sm text-text">{provider.displayName}</span>

            {/* A provider enabled without a key cannot serve anything — say so. */}
            {provider.hasKey ? (
              <span className="rounded border border-success-border bg-success-subtle px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-success">
                key present
              </span>
            ) : (
              <span className="rounded border border-warning/40 bg-warning/5 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-warning">
                no {provider.apiKeyEnvVar ?? 'key'}
              </span>
            )}

            <label className="ml-auto inline-flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={provider.enabled}
                disabled={pending}
                onChange={(event) => run(() => setProviderEnabled(provider.id, event.target.checked))}
                className="h-3.5 w-3.5 rounded border-border"
              />
              Enabled
            </label>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="text-sm font-medium text-text">Models</h3>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Models with pricing and availability</caption>
            <thead>
              <tr className="bg-surface-raised text-left text-[0.6875rem] uppercase tracking-wider text-text-muted">
                <th scope="col" className="px-3 py-2 font-medium">Model</th>
                <th scope="col" className="px-3 py-2 font-medium">Provider</th>
                <th scope="col" className="px-3 py-2 font-medium">Credit cost</th>
                <th scope="col" className="px-3 py-2 font-medium">Plans</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">In / M</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Out / M</th>
                <th scope="col" className="px-3 py-2 font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className="border-t border-border bg-surface">
                  <td className="px-3 py-2">
                    <span className="block text-text">{model.displayName}</span>
                    <code className="text-[0.625rem] text-text-muted">{model.key}</code>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{model.providerKey}</td>
                  <td className="px-3 py-2">
                    {/*
                      What a message on this model costs a customer, taken from
                      the same weights the meter applies — not a second copy
                      that could disagree with the bill.
                    */}
                    <span className="tabular-nums text-text">
                      {model.creditsPerThousandTokens}
                    </span>
                    <span className="ml-1 text-[0.625rem] text-text-muted">cr / 1k</span>
                    <span className="ml-2 rounded border border-border px-1 text-[0.625rem] uppercase tracking-wide text-text-muted">
                      {model.costTier}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {model.plans.length === 0 ? (
                      <span className="text-text-muted">All plans</span>
                    ) : (
                      model.plans.join(', ')
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    ${model.inputCostPerMillion}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    ${model.outputCostPerMillion}
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        disabled={pending}
                        onChange={(event) => run(() => setModelEnabled(model.id, event.target.checked))}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      {/*
                        A model can be enabled while its provider is not. Saying
                        so beats a checkbox that looks on but changes nothing.
                      */}
                      {model.enabled && !model.providerEnabled ? (
                        <span className="text-warning">provider off</span>
                      ) : null}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
