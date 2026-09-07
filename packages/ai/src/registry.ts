/**
 * The model registry (spec §10).
 *
 * Models are database rows, not constants. This module is the only reader:
 * everything downstream — the selector, Reklu Auto, usage costing — consumes
 * `RegisteredModel`, so enabling a model or changing its plan availability is a
 * configuration change rather than a deploy.
 */
import { and, asc, eq } from 'drizzle-orm';
import { aiModels, aiProviders, db } from '@reklu/database';
import type { PlanLimits } from '@reklu/database';
import {
  configuredProviderKeys,
  DEV_ECHO_MODEL_KEY,
  DEV_ECHO_PROVIDER_KEY,
  DEV_ECHO_SLOW_MODEL_KEY,
  shouldUseDevelopmentMock,
} from './providers';

export interface RegisteredModel {
  readonly key: string;
  readonly modelIdentifier: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly providerKey: string;
  readonly providerName: string;

  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsStructuredOutput: boolean;

  readonly speed: 'fast' | 'balanced' | 'slow';
  readonly costTier: 'economy' | 'standard' | 'premium';
  readonly inputCostPerMillion: number;
  readonly outputCostPerMillion: number;

  readonly bestFor: readonly string[];
  readonly routingPriority: number;
  readonly sortOrder: number;

  /** True when the provider credential is actually present on this instance. */
  readonly isConfigured: boolean;
  /** True for the development mock; the UI must label it. */
  readonly isDevelopmentMock: boolean;
}

/**
 * The development mock, shaped as registry rows so nothing downstream branches.
 * Two variants exist purely so Compare Mode (which needs two models) is
 * exercisable without provider keys.
 */
const devEchoModel = (key: string, displayName: string, description: string): RegisteredModel => ({
  key,
  modelIdentifier: key,
  displayName,
  description,
  providerKey: DEV_ECHO_PROVIDER_KEY,
  providerName: 'Development Mock',
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  supportsVision: false,
  supportsTools: false,
  supportsReasoning: false,
  supportsStructuredOutput: false,
  speed: 'fast',
  costTier: 'economy',
  inputCostPerMillion: 0,
  outputCostPerMillion: 0,
  bestFor: ['general'],
  routingPriority: 0,
  sortOrder: 9_999,
  isConfigured: true,
  isDevelopmentMock: true,
});

const DEV_ECHO_MODELS: readonly RegisteredModel[] = [
  devEchoModel(
    DEV_ECHO_MODEL_KEY,
    'Development Mock',
    'Echoes your request. Not a real model — no provider key is configured.',
  ),
  devEchoModel(
    DEV_ECHO_SLOW_MODEL_KEY,
    'Development Mock (slow)',
    'A second mock that streams more slowly, so Compare Mode is testable without keys.',
  ),
];

/**
 * Every enabled model, annotated with whether this instance can actually call
 * it. Unconfigured models are still returned so the UI can show them as
 * unavailable rather than hiding capability that exists in the product.
 */
export async function loadRegistry(): Promise<readonly RegisteredModel[]> {
  const rows = await db
    .select({
      key: aiModels.key,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      description: aiModels.description,
      contextWindow: aiModels.contextWindow,
      maxOutputTokens: aiModels.maxOutputTokens,
      supportsVision: aiModels.supportsVision,
      supportsTools: aiModels.supportsTools,
      supportsReasoning: aiModels.supportsReasoning,
      supportsStructuredOutput: aiModels.supportsStructuredOutput,
      speed: aiModels.speed,
      costTier: aiModels.costTier,
      inputCostPerMillion: aiModels.inputCostPerMillion,
      outputCostPerMillion: aiModels.outputCostPerMillion,
      bestFor: aiModels.bestFor,
      routingPriority: aiModels.routingPriority,
      sortOrder: aiModels.sortOrder,
      internalOnly: aiModels.internalOnly,
      providerKey: aiProviders.key,
      providerName: aiProviders.displayName,
      providerEnabled: aiProviders.enabled,
      maintenanceMode: aiProviders.maintenanceMode,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(and(eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
    .orderBy(asc(aiModels.sortOrder));

  const configured = new Set(configuredProviderKeys());

  const models: RegisteredModel[] = rows
    // A provider in maintenance is unavailable regardless of its credential.
    .filter((row) => !row.maintenanceMode)
    .map((row) => ({
      key: row.key,
      modelIdentifier: row.modelIdentifier,
      displayName: row.displayName,
      description: row.description,
      providerKey: row.providerKey,
      providerName: row.providerName,
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      supportsVision: row.supportsVision,
      supportsTools: row.supportsTools,
      supportsReasoning: row.supportsReasoning,
      supportsStructuredOutput: row.supportsStructuredOutput,
      speed: row.speed,
      costTier: row.costTier,
      inputCostPerMillion: Number(row.inputCostPerMillion),
      outputCostPerMillion: Number(row.outputCostPerMillion),
      bestFor: row.bestFor,
      routingPriority: row.routingPriority,
      sortOrder: row.sortOrder,
      isConfigured: configured.has(row.providerKey),
      isDevelopmentMock: false,
    }));

  if (shouldUseDevelopmentMock()) models.push(...DEV_ECHO_MODELS);
  return models;
}

/** Models this workspace's plan permits, and this instance can actually call. */
export function selectableModels(
  registry: readonly RegisteredModel[],
  limits: PlanLimits | undefined,
): readonly RegisteredModel[] {
  const allowed = limits?.allowedModelKeys ?? [];
  return registry.filter((model) => {
    // The development mock stands in when nothing real is configured, so it is
    // exempt from plan gating — otherwise a plan allowlist (which naturally
    // names only real models) would leave a developer with no usable model at
    // all and Chat would wrongly report itself as unconfigured.
    if (model.isDevelopmentMock) return true;

    if (!model.isConfigured) return false;
    // An empty allowlist means every enabled model.
    if (allowed.length > 0 && !allowed.includes(model.key)) return false;
    return true;
  });
}

/**
 * Models Reklu may choose without a person naming the model.
 *
 * DeepSeek, Kimi, OpenRouter, and B.AI use separately funded provider
 * accounts (and OpenRouter/B.AI may reject requests for upstream capacity or
 * balance). Merely configuring those credentials must not authorize
 * background jobs or Reklu Auto to spend them. They remain visible and
 * selectable; only an explicit model key can opt a request into those
 * providers.
 */
const EXPLICIT_SELECTION_PROVIDER_KEYS = new Set(['deepseek', 'kimi', 'openrouter', 'bai']);

export function autoRoutableModels(
  models: readonly RegisteredModel[],
): readonly RegisteredModel[] {
  return models.filter(
    (model) =>
      model.isDevelopmentMock || !EXPLICIT_SELECTION_PROVIDER_KEYS.has(model.providerKey),
  );
}

export function findModel(
  registry: readonly RegisteredModel[],
  key: string,
): RegisteredModel | undefined {
  return registry.find((model) => model.key === key);
}

/** Grouped for the model selector, preserving registry order (spec §11). */
export function groupByProvider(
  models: readonly RegisteredModel[],
): readonly { providerKey: string; providerName: string; models: readonly RegisteredModel[] }[] {
  const groups = new Map<string, { providerName: string; models: RegisteredModel[] }>();
  for (const model of models) {
    const group = groups.get(model.providerKey) ?? { providerName: model.providerName, models: [] };
    group.models.push(model);
    groups.set(model.providerKey, group);
  }
  return [...groups.entries()].map(([providerKey, group]) => ({
    providerKey,
    providerName: group.providerName,
    models: group.models,
  }));
}
