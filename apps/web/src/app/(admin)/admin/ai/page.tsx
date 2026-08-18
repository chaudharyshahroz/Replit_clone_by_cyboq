import type { Metadata } from 'next';
import { features } from '@reklu/shared';
import { listModels, listProviders } from '@/lib/admin-data';
import { AiControls } from '@/components/admin/ai-controls';

export const metadata: Metadata = { title: 'Admin · AI' };
export const dynamic = 'force-dynamic';

export default async function AdminAiPage() {
  const [providers, models] = await Promise.all([listProviders(), listModels()]);
  const configured = features();

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
              // Whether the key is present — never its value.
              hasKey:
                (provider.key === 'anthropic' && configured.anthropic) ||
                (provider.key === 'openai' && configured.openai) ||
                (provider.key === 'google' && configured.google) ||
                (provider.key === 'xai' && configured.xai) ||
                (provider.key === 'deepseek' && configured.deepseek),
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
            }))}
          />
        </div>
      </section>
    </div>
  );
}
