import type { Metadata } from 'next';
import { listModels, listPlans, listProviders } from '@/lib/admin-data';
import { configuredProviderKeys, TIER_WEIGHT } from '@reklu/ai';
import { AiControls } from '@/components/admin/ai-controls';

export const metadata: Metadata = { title: 'Admin · AI' };
export const dynamic = 'force-dynamic';

export default async function AdminAiPage() {
  const [providers, models, plansList] = await Promise.all([
    listProviders(),
    listModels(),
    listPlans(),
  ]);
  const configuredKeys = configuredProviderKeys();

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-text">Providers</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
          A provider needs both a key in the environment and to be enabled here.
          Disabling one removes its models from routing immediately; the key stays
          where it is.
        </p>
        <div className="mt-3">
          <AiControls
            providers={providers.map((provider) => ({
              id: provider.id,
              key: provider.key,
              displayName: provider.displayName,
              apiKeyEnvVar: provider.apiKeyEnvVar,
              enabled: provider.enabled,
              /*
                Whether the key is present — never its value.

                Asked of the same function that decides whether a provider can
                actually be used, rather than a list of provider names written
                out here. That list named five providers and a sixth existed:
                OpenRouter showed NO OPENROUTER_API_KEY while its key was set,
                its models were listed, and it was answering requests. A panel
                whose job is to report configuration was reporting its own
                omission.
              */
              hasKey: configuredKeys.includes(provider.key),
            }))}
            models={models.map((model) => ({
              id: model.id,
              key: model.key,
              displayName: model.displayName,
              providerKey: model.providerKey,
              enabled: model.enabled,
              providerEnabled: model.providerEnabled,
              costTier: model.costTier,
              inputCostPerMillion: model.inputCostPerMillion,
              outputCostPerMillion: model.outputCostPerMillion,
              creditsPerThousandTokens:
                TIER_WEIGHT[model.costTier as keyof typeof TIER_WEIGHT] ?? 1,
              /*
               * A plan with no explicit list allows every model, so it is not
               * named here — listing every plan against every model would say
               * nothing. Only restrictions are worth showing.
               */
              plans: plansList
                .filter((plan) => plan.limits.allowedModelKeys.includes(model.key))
                .map((plan) => plan.name),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
