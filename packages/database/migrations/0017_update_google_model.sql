-- Google retired Gemini 2.5 Pro for new API users. Keep the stable Reklu
-- model key so plan allowlists and saved selections remain valid, while
-- routing requests to the currently supported replacement.
UPDATE "ai_models"
SET
  "model_identifier" = 'gemini-3.1-pro-preview',
  "display_name" = 'Gemini 3.1 Pro Preview',
  "description" = 'Current Google reasoning model with very large context and multimodal understanding.',
  "updated_at" = NOW()
WHERE "key" = 'gemini-2-5-pro';
