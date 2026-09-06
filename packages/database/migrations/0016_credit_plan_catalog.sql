-- Install the initial cost-based Reklu plan catalog. This migration is a
-- deliberate one-time product pricing change; later administrator edits remain
-- authoritative because the regular seed does not overwrite commercial fields.
INSERT INTO "plans" (
  "id", "key", "name", "description", "price_monthly_usd",
  "price_yearly_usd", "is_purchasable", "limits", "sort_order"
)
VALUES
  ('plan_free', 'free', 'Free', 'Explore Reklu with everyday models and limited usage.', 0, 0, false,
   '{"aiUnitsPerMonth":30,"deepResearchPerMonth":3,"buildProjectsMax":2,"imageGenerationsPerMonth":20,"videoGenerationsPerMonth":0,"fileUploadMaxMb":10,"storageMaxGb":1,"workspaceMembersMax":1,"mcpServersMax":1,"concurrentJobsMax":1,"allowedModelKeys":["claude-haiku-4-5","gpt-5-mini","gemini-2-5-flash","openrouter-nemotron-ultra-free","openrouter-laguna-s-free","openrouter-glm-52-free","openrouter-north-mini-code-free","openrouter-nemotron-super-free","openrouter-minimax-m27-free","bai-deepseek-v4-flash","bai-deepseek-v4-flash-vision","bai-glm-53-flash","bai-qwen38-flash","bai-mimo-v25","bai-hy3"],"features":["chat","research_quick","projects","skills_install"]}'::jsonb, 10),
  ('plan_plus', 'plus', 'Plus', 'More everyday AI, projects, and research for individual work.', 19, 190, true,
   '{"aiUnitsPerMonth":550,"deepResearchPerMonth":20,"buildProjectsMax":10,"imageGenerationsPerMonth":100,"videoGenerationsPerMonth":5,"fileUploadMaxMb":25,"storageMaxGb":10,"workspaceMembersMax":1,"mcpServersMax":5,"concurrentJobsMax":2,"allowedModelKeys":[],"features":["chat","compare","research_quick","research","projects","artifacts","build","skills_install","images"]}'::jsonb, 20),
  ('plan_pro', 'pro', 'Pro', 'Every model, deep research, and real application builds.', 39, 390, true,
   '{"aiUnitsPerMonth":1150,"deepResearchPerMonth":100,"buildProjectsMax":50,"imageGenerationsPerMonth":500,"videoGenerationsPerMonth":20,"fileUploadMaxMb":50,"storageMaxGb":50,"workspaceMembersMax":1,"mcpServersMax":20,"concurrentJobsMax":3,"allowedModelKeys":[],"features":["chat","compare","research_quick","research","research_deep","projects","artifacts","build","build_mobile","skills_install","skills_create","mcp","connections","agents","images","video"]}'::jsonb, 30),
  ('plan_builder', 'builder', 'Builder', 'The Vibe Coding plan for production application builds.', 79, 790, true,
   '{"aiUnitsPerMonth":2350,"deepResearchPerMonth":200,"buildProjectsMax":150,"imageGenerationsPerMonth":1000,"videoGenerationsPerMonth":40,"fileUploadMaxMb":100,"storageMaxGb":150,"workspaceMembersMax":1,"mcpServersMax":50,"concurrentJobsMax":5,"allowedModelKeys":[],"features":["chat","compare","research_quick","research","research_deep","projects","artifacts","build","build_mobile","skills_install","skills_create","mcp","connections","agents","images","video"]}'::jsonb, 40),
  ('plan_max', 'max', 'Max', 'High-capacity AI, research, media, and application building.', 149, 1490, true,
   '{"aiUnitsPerMonth":4450,"deepResearchPerMonth":null,"buildProjectsMax":null,"imageGenerationsPerMonth":2000,"videoGenerationsPerMonth":100,"fileUploadMaxMb":200,"storageMaxGb":500,"workspaceMembersMax":1,"mcpServersMax":null,"concurrentJobsMax":10,"allowedModelKeys":[],"features":["chat","compare","research_quick","research","research_deep","projects","artifacts","build","build_mobile","skills_install","skills_create","mcp","connections","agents","images","video"]}'::jsonb, 50),
  ('plan_team', 'team', 'Team', 'Shared workspaces, shared skills, and centralised billing.', 299, 2990, true,
   '{"aiUnitsPerMonth":8950,"deepResearchPerMonth":null,"buildProjectsMax":null,"imageGenerationsPerMonth":2000,"videoGenerationsPerMonth":100,"fileUploadMaxMb":100,"storageMaxGb":500,"workspaceMembersMax":25,"mcpServersMax":null,"concurrentJobsMax":10,"allowedModelKeys":[],"features":["chat","compare","research_quick","research","research_deep","projects","artifacts","build","build_mobile","skills_install","skills_create","skills_share","mcp","connections","agents","images","video","teams","sso_ready","audit_log"]}'::jsonb, 60)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "price_monthly_usd" = EXCLUDED."price_monthly_usd",
  "price_yearly_usd" = EXCLUDED."price_yearly_usd",
  "is_purchasable" = EXCLUDED."is_purchasable",
  "limits" = EXCLUDED."limits",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = NOW();
