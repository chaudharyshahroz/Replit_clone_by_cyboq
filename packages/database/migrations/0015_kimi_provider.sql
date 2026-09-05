ALTER TYPE "public"."ai_provider_kind" ADD VALUE IF NOT EXISTS 'kimi';
--> statement-breakpoint
UPDATE "ai_models"
SET "enabled" = false, "updated_at" = NOW()
WHERE "key" = 'deepseek-reasoner';
