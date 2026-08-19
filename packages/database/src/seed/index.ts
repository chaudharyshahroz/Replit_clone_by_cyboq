/**
 * Idempotent seeding of configuration rows.
 *
 * Safe to run on every deploy: every write is an upsert keyed on a stable
 * business key, so re-running never duplicates and never clobbers an
 * administrator's changes to fields they own (enabled/disabled state, pricing,
 * routing priority).
 */
import { eq, sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { logger, newId } from '@reklu/shared';
import { closeDatabase, db } from '../client';
import {
  aiModels,
  aiProviders,
  featureFlags,
  plans,
  skills,
  skillVersions,
} from '../schema';
import { BUILT_IN_SKILLS, FEATURE_FLAGS, MODELS, PLANS, PROVIDERS } from './data';

export async function seed(): Promise<void> {
  const started = Date.now();
  logger.info('Seeding configuration data');

  // ---- Providers ---------------------------------------------------------
  for (const provider of PROVIDERS) {
    await db
      .insert(aiProviders)
      .values({
        kind: provider.kind,
        key: provider.key,
        displayName: provider.displayName,
        apiKeyEnvVar: provider.apiKeyEnvVar,
      })
      .onConflictDoUpdate({
        target: aiProviders.key,
        // `enabled` and `maintenanceMode` are admin-owned; seeding must not
        // silently re-enable a provider an operator deliberately turned off.
        set: {
          displayName: provider.displayName,
          apiKeyEnvVar: provider.apiKeyEnvVar,
          updatedAt: new Date(),
        },
      });
  }

  const providerRows = await db
    .select({ id: aiProviders.id, key: aiProviders.key })
    .from(aiProviders);
  const providerIdByKey = new Map(providerRows.map((r) => [r.key, r.id]));

  // ---- Models ------------------------------------------------------------
  for (const model of MODELS) {
    const providerId = providerIdByKey.get(model.providerKey);
    if (!providerId) {
      throw new Error(`Model ${model.key} references unknown provider ${model.providerKey}`);
    }

    await db
      .insert(aiModels)
      .values({
        providerId,
        key: model.key,
        modelIdentifier: model.modelIdentifier,
        displayName: model.displayName,
        description: model.description,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsVision: model.supportsVision,
        supportsTools: model.supportsTools,
        supportsReasoning: model.supportsReasoning,
        supportsStructuredOutput: model.supportsStructuredOutput,
        supportsFiles: model.supportsFiles,
        speed: model.speed,
        costTier: model.costTier,
        inputCostPerMillion: model.inputCostPerMillion,
        outputCostPerMillion: model.outputCostPerMillion,
        bestFor: [...model.bestFor],
        routingPriority: model.routingPriority,
        sortOrder: model.sortOrder,
      })
      .onConflictDoUpdate({
        target: aiModels.key,
        // Capability metadata is refreshed; `enabled`, pricing overrides and
        // plan availability stay under admin control (spec §80).
        set: {
          providerId,
          modelIdentifier: model.modelIdentifier,
          displayName: model.displayName,
          description: model.description,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          supportsVision: model.supportsVision,
          supportsTools: model.supportsTools,
          supportsReasoning: model.supportsReasoning,
          supportsStructuredOutput: model.supportsStructuredOutput,
          supportsFiles: model.supportsFiles,
          speed: model.speed,
          costTier: model.costTier,
          bestFor: [...model.bestFor],
          sortOrder: model.sortOrder,
          updatedAt: new Date(),
        },
      });
  }

  // ---- Plans -------------------------------------------------------------
  for (const plan of PLANS) {
    await db
      .insert(plans)
      .values({
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceMonthlyUsd: plan.priceMonthlyUsd,
        priceYearlyUsd: plan.priceYearlyUsd,
        sortOrder: plan.sortOrder,
        limits: plan.limits,
        // Anything with a price is something to sell; Free is not.
        isPurchasable: Number(plan.priceMonthlyUsd) > 0,
      })
      .onConflictDoUpdate({
        target: plans.key,
        set: {
          /*
           * Only what the code still owns.
           *
           * Name, description, price and purchasability are edited in the admin
           * panel now, so re-seeding must not reach in and undo someone's
           * pricing change — a deploy would quietly reset the shop.
           */
          limits: plan.limits,
          sortOrder: plan.sortOrder,
          updatedAt: new Date(),
        },
      });
  }

  // ---- Feature flags -----------------------------------------------------
  for (const flag of FEATURE_FLAGS) {
    await db
      .insert(featureFlags)
      .values({
        key: flag.key,
        description: flag.description,
        enabled: flag.enabled,
      })
      .onConflictDoUpdate({
        target: featureFlags.key,
        // Only the description is refreshed — a flag's rollout state belongs to
        // whoever is running the rollout, not to the seed file.
        set: { description: flag.description, updatedAt: new Date() },
      });
  }

  // ---- Built-in skills ---------------------------------------------------
  for (const skill of BUILT_IN_SKILLS) {
    const existing = await db
      .select({ id: skills.id })
      .from(skills)
      .where(sql`${skills.handle} = ${skill.handle} AND ${skills.workspaceId} IS NULL`)
      .limit(1);

    let skillId = existing[0]?.id;

    if (skillId) {
      await db
        .update(skills)
        .set({
          name: skill.name,
          description: skill.description,
          icon: skill.icon,
          category: skill.category,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, skillId));
    } else {
      skillId = newId('skill');
      await db.insert(skills).values({
        id: skillId,
        workspaceId: null,
        handle: skill.handle,
        name: skill.name,
        description: skill.description,
        icon: skill.icon,
        category: skill.category,
        isBuiltIn: true,
        visibility: 'public',
        publishedAt: new Date(),
      });
    }

    // Versions are immutable: only append when the instructions actually differ.
    const latest = await db
      .select({ id: skillVersions.id, instructions: skillVersions.instructions, version: skillVersions.version })
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId))
      .orderBy(sql`${skillVersions.version} DESC`)
      .limit(1);

    const current = latest[0];
    if (!current || current.instructions !== skill.instructions) {
      const versionId = newId('skillVersion');
      await db.insert(skillVersions).values({
        id: versionId,
        skillId,
        version: (current?.version ?? 0) + 1,
        instructions: skill.instructions,
        preferredModelKey: skill.preferredModelKey,
        changelog: current ? 'Updated built-in instructions' : 'Initial version',
      });
      await db.update(skills).set({ currentVersionId: versionId }).where(eq(skills.id, skillId));
    }
  }

  logger.info('Seed complete', {
    durationMs: Date.now() - started,
    providers: PROVIDERS.length,
    models: MODELS.length,
    plans: PLANS.length,
    flags: FEATURE_FLAGS.length,
    skills: BUILT_IN_SKILLS.length,
  });
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  seed()
    .then(() => closeDatabase())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      logger.error('Seed failed', { error });
      await closeDatabase().catch(() => {});
      process.exit(1);
    });
}
