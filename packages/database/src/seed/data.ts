/**
 * Seed data.
 *
 * This is configuration, not fixtures: plans, providers, and the model registry
 * are rows the product genuinely reads at runtime (spec §138 — seed data is
 * acceptable, but must be clearly separated from fabricated demo content).
 * Nothing here invents users, projects, or conversations.
 *
 * IMPORTANT — model identifiers change frequently. These are starting values;
 * an administrator can enable, disable, re-price, or re-label any model from the
 * admin panel without a deploy (spec §80). Verify identifiers against each
 * provider's current documentation before production use.
 */
import type { PlanLimits } from '../schema/billing';

export interface ProviderSeed {
  readonly key: string;
  readonly kind: 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek' | 'openrouter' | 'bai';
  readonly displayName: string;
  readonly apiKeyEnvVar: string;
}

export const PROVIDERS: readonly ProviderSeed[] = [
  { key: 'anthropic', kind: 'anthropic', displayName: 'Anthropic', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
  { key: 'openai', kind: 'openai', displayName: 'OpenAI', apiKeyEnvVar: 'OPENAI_API_KEY' },
  { key: 'google', kind: 'google', displayName: 'Google', apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { key: 'xai', kind: 'xai', displayName: 'xAI', apiKeyEnvVar: 'XAI_API_KEY' },
  { key: 'deepseek', kind: 'deepseek', displayName: 'DeepSeek', apiKeyEnvVar: 'DEEPSEEK_API_KEY' },
  {
    key: 'openrouter',
    kind: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
  },
  { key: 'bai', kind: 'bai', displayName: 'B.AI', apiKeyEnvVar: 'BAI_API_KEY' },
];

export interface ModelSeed {
  readonly key: string;
  readonly providerKey: string;
  readonly modelIdentifier: string;
  readonly displayName: string;
  readonly description: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsFiles: boolean;
  readonly speed: 'fast' | 'balanced' | 'slow';
  readonly costTier: 'economy' | 'standard' | 'premium';
  readonly inputCostPerMillion: string;
  readonly outputCostPerMillion: string;
  /** Scored by Reklu Auto when matching a request to a model. */
  readonly bestFor: readonly string[];
  readonly routingPriority: number;
  readonly sortOrder: number;
}

const base = {
  supportsStructuredOutput: true,
  supportsFiles: true,
  supportsTools: true,
} as const;

export const MODELS: readonly ModelSeed[] = [
  // ---- Anthropic ---------------------------------------------------------
  {
    ...base,
    key: 'claude-opus-5',
    providerKey: 'anthropic',
    modelIdentifier: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    description: 'Strongest reasoning and long-horizon coding.',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'slow',
    costTier: 'premium',
    inputCostPerMillion: '15.0000',
    outputCostPerMillion: '75.0000',
    bestFor: ['reasoning', 'coding', 'analysis', 'agent', 'long-context'],
    routingPriority: 100,
    sortOrder: 10,
  },
  {
    ...base,
    key: 'claude-sonnet-5',
    providerKey: 'anthropic',
    modelIdentifier: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    description: 'Balanced quality and speed. A strong default.',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'balanced',
    costTier: 'standard',
    inputCostPerMillion: '3.0000',
    outputCostPerMillion: '15.0000',
    bestFor: ['general', 'coding', 'writing', 'research', 'agent'],
    routingPriority: 90,
    sortOrder: 20,
  },
  {
    ...base,
    key: 'claude-haiku-4-5',
    providerKey: 'anthropic',
    modelIdentifier: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    description: 'Fast and inexpensive for lightweight work.',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsVision: true,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '1.0000',
    outputCostPerMillion: '5.0000',
    bestFor: ['quick', 'classification', 'summarization', 'titling'],
    routingPriority: 60,
    sortOrder: 30,
  },

  // ---- OpenAI ------------------------------------------------------------
  {
    ...base,
    key: 'gpt-5',
    providerKey: 'openai',
    modelIdentifier: 'gpt-5',
    displayName: 'GPT-5',
    description: 'Frontier general-purpose reasoning.',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'balanced',
    costTier: 'premium',
    inputCostPerMillion: '1.2500',
    outputCostPerMillion: '10.0000',
    bestFor: ['reasoning', 'general', 'coding', 'analysis'],
    routingPriority: 95,
    sortOrder: 40,
  },
  {
    ...base,
    key: 'gpt-5-mini',
    providerKey: 'openai',
    modelIdentifier: 'gpt-5-mini',
    displayName: 'GPT-5 mini',
    description: 'Cost-efficient with broad capability.',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.2500',
    outputCostPerMillion: '2.0000',
    bestFor: ['quick', 'general', 'summarization'],
    routingPriority: 55,
    sortOrder: 50,
  },

  // ---- Google ------------------------------------------------------------
  {
    ...base,
    key: 'gemini-2-5-pro',
    providerKey: 'google',
    modelIdentifier: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    description: 'Very large context and strong multimodal understanding.',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'balanced',
    costTier: 'standard',
    inputCostPerMillion: '1.2500',
    outputCostPerMillion: '10.0000',
    bestFor: ['long-context', 'vision', 'document-analysis', 'research'],
    routingPriority: 85,
    sortOrder: 60,
  },
  {
    ...base,
    key: 'gemini-2-5-flash',
    providerKey: 'google',
    modelIdentifier: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    description: 'Fast, cheap, very large context.',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsVision: true,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.3000',
    outputCostPerMillion: '2.5000',
    bestFor: ['quick', 'long-context', 'vision', 'summarization'],
    routingPriority: 50,
    sortOrder: 70,
  },

  // ---- xAI ---------------------------------------------------------------
  {
    ...base,
    key: 'grok-4',
    providerKey: 'xai',
    modelIdentifier: 'grok-4',
    displayName: 'Grok 4',
    description: 'Strong reasoning with current-events awareness.',
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    supportsVision: true,
    supportsReasoning: true,
    speed: 'balanced',
    costTier: 'standard',
    inputCostPerMillion: '3.0000',
    outputCostPerMillion: '15.0000',
    bestFor: ['reasoning', 'general', 'current-events'],
    routingPriority: 70,
    sortOrder: 80,
  },

  // ---- DeepSeek ----------------------------------------------------------
  {
    ...base,
    key: 'deepseek-reasoner',
    providerKey: 'deepseek',
    modelIdentifier: 'deepseek-reasoner',
    displayName: 'DeepSeek Reasoner',
    description: 'Open-weight reasoning at low cost.',
    contextWindow: 128_000,
    maxOutputTokens: 32_000,
    supportsVision: false,
    supportsReasoning: true,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.5600',
    outputCostPerMillion: '1.6800',
    bestFor: ['reasoning', 'math', 'coding'],
    routingPriority: 45,
    sortOrder: 90,
  },

  // ---- OpenRouter --------------------------------------------------------
  //
  // The free tier, which is genuinely free and genuinely limited: a few
  // requests a minute, a daily cap, and no promise that any given model stays
  // on it.
  //
  // Every identifier here was verified against the live API rather than
  // remembered. The first set was not, and all three had been withdrawn within
  // days — the failure reads as "this model is unavailable for free", which is
  // a sentence about the tier, not about Reklu. Treat these as perishable:
  // when one dies, replace it here rather than only in the database, because
  // seeding overwrites the identifier and would otherwise resurrect the dead
  // one on the next deploy.
  //
  // Routing priority is low on purpose. These are a way to run Reklu at no
  // cost, not the best model for the job, so Reklu Auto reaches for them only
  // when nothing better is configured.
  // ---- B.AI ---------------------------------------------------------------
  //
  // Free on an OpenAI-compatible API. The identifiers came from the operator
  // rather than from B.AI's own list, which returns an id and nothing that
  // would confirm one — so they are seeded as given and checked by using them.
  // `GET https://api.b.ai/v1/models` with the key reports what that credential
  // can actually reach.
  {
    ...base,
    key: 'bai-deepseek-v4-flash',
    providerKey: 'bai',
    modelIdentifier: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash (free)',
    description: 'Free through B.AI. Fast general and coding model.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding', 'general', 'quick'],
    routingPriority: 18,
    sortOrder: 300,
  },
  {
    ...base,
    key: 'bai-deepseek-v4-flash-vision',
    providerKey: 'bai',
    modelIdentifier: 'deepseek-v4-flash-vision-exp',
    displayName: 'DeepSeek V4 Flash Vision (free)',
    description: 'Free through B.AI. Reads images as well as text. Experimental.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: true,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general', 'vision'],
    routingPriority: 15,
    sortOrder: 310,
  },
  {
    ...base,
    key: 'bai-glm-53-flash',
    providerKey: 'bai',
    modelIdentifier: 'glm-5.3-flash',
    displayName: 'GLM 5.3 Flash (free)',
    description: 'Free through B.AI. Strong at coding and tool use.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding', 'reasoning'],
    routingPriority: 17,
    sortOrder: 320,
  },
  {
    ...base,
    key: 'bai-qwen38-flash',
    providerKey: 'bai',
    modelIdentifier: 'qwen3.8-flash',
    displayName: 'Qwen 3.8 Flash (free)',
    description: 'Free through B.AI. Fast general-purpose model.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general', 'quick'],
    routingPriority: 16,
    sortOrder: 330,
  },
  {
    ...base,
    key: 'bai-mimo-v25',
    providerKey: 'bai',
    modelIdentifier: 'mimo-v2.5',
    displayName: 'MiMo v2.5 (free)',
    description: 'Free through B.AI.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general'],
    routingPriority: 14,
    sortOrder: 340,
  },
  {
    ...base,
    key: 'bai-hy3',
    providerKey: 'bai',
    modelIdentifier: 'hy3',
    displayName: 'HY3 (free)',
    description: 'Free through B.AI.',
    /*
     * A conservative window: B.AI's model list reports an id and nothing else,
     * so this is a floor rather than a measurement. The router penalises a
     * window that barely fits, which errs toward not choosing these — the safe
     * direction for a number nobody has confirmed.
     */
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'fast',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general'],
    routingPriority: 13,
    sortOrder: 350,
  },

  {
    ...base,
    key: 'openrouter-nemotron-ultra-free',
    providerKey: 'openrouter',
    modelIdentifier: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    displayName: 'Nemotron 3 Ultra (free)',
    description: 'Free through OpenRouter. 550B MoE for agent orchestration and coding agents.',
    contextWindow: 1_000_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding', 'reasoning', 'general'],
    routingPriority: 14,
    sortOrder: 240,
  },
  {
    ...base,
    key: 'openrouter-laguna-s-free',
    providerKey: 'openrouter',
    modelIdentifier: 'poolside/laguna-s-2.1:free',
    displayName: 'Laguna S 2.1 (free)',
    description: 'Free through OpenRouter. A coding agent model built for software engineering.',
    contextWindow: 262_144,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding'],
    routingPriority: 13,
    sortOrder: 250,
  },
  {
    ...base,
    key: 'openrouter-glm-52-free',
    providerKey: 'openrouter',
    modelIdentifier: 'z-ai/glm-5.2:free',
    displayName: 'GLM 5.2 (free)',
    description: 'Free through OpenRouter. Strong at coding, but heavily contended on the free tier.',
    contextWindow: 256_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding', 'reasoning'],
    routingPriority: 12,
    sortOrder: 260,
  },
  {
    ...base,
    key: 'openrouter-north-mini-code-free',
    providerKey: 'openrouter',
    modelIdentifier: 'cohere/north-mini-code:free',
    displayName: 'North Mini Code (free)',
    description: 'Free through OpenRouter. Built for code generation and agentic software work.',
    contextWindow: 256_000,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['coding'],
    routingPriority: 11,
    sortOrder: 270,
  },
  {
    ...base,
    key: 'openrouter-nemotron-super-free',
    providerKey: 'openrouter',
    modelIdentifier: 'nvidia/nemotron-3-super-120b-a12b:free',
    displayName: 'Nemotron 3 Super (free)',
    description: 'Free through OpenRouter. 120B hybrid MoE for multi-step agent work.',
    contextWindow: 262_144,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general', 'reasoning'],
    routingPriority: 10,
    sortOrder: 280,
  },
  {
    ...base,
    key: 'openrouter-minimax-m27-free',
    providerKey: 'openrouter',
    modelIdentifier: 'minimax/minimax-m2.7:free',
    displayName: 'MiniMax M2.7 (free)',
    description: 'Free through OpenRouter. Agentic model for debugging and long document work.',
    contextWindow: 196_608,
    maxOutputTokens: 16_000,
    supportsVision: false,
    supportsReasoning: false,
    speed: 'slow',
    costTier: 'economy',
    inputCostPerMillion: '0.0000',
    outputCostPerMillion: '0.0000',
    bestFor: ['general', 'reasoning', 'coding'],
    routingPriority: 9,
    sortOrder: 290,
  },
];

// ---------------------------------------------------------------------------
// Plans (spec §73 — pricing is data, never hard-coded into business logic)
// ---------------------------------------------------------------------------

export interface PlanSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly priceMonthlyUsd: string;
  readonly priceYearlyUsd: string;
  readonly sortOrder: number;
  readonly limits: PlanLimits;
}

export const PLANS: readonly PlanSeed[] = [
  {
    key: 'free',
    name: 'Free',
    description: 'Explore Reklu with everyday models and limited usage.',
    priceMonthlyUsd: '0.00',
    priceYearlyUsd: '0.00',
    sortOrder: 10,
    limits: {
      aiUnitsPerMonth: 200,
      deepResearchPerMonth: 3,
      buildProjectsMax: 2,
      imageGenerationsPerMonth: 20,
      videoGenerationsPerMonth: 0,
      fileUploadMaxMb: 10,
      storageMaxGb: 1,
      workspaceMembersMax: 1,
      mcpServersMax: 1,
      concurrentJobsMax: 1,
      // Economy tier only; premium models require a paid plan.
      /*
       * The cheap end of each paid vendor, plus every model that costs nothing
       * to serve.
       *
       * The free models were missing from this list, which put Reklu in the
       * position of offering models that are free and then refusing them to the
       * people on the free plan — the only ones for whom the distinction
       * mattered. An allowlist is a spending control, and a model with no price
       * is not something to control.
       */
      allowedModelKeys: [
        'claude-haiku-4-5',
        'gpt-5-mini',
        'gemini-2-5-flash',
        'openrouter-nemotron-ultra-free',
        'openrouter-laguna-s-free',
        'openrouter-glm-52-free',
        'openrouter-north-mini-code-free',
        'openrouter-nemotron-super-free',
        'openrouter-minimax-m27-free',
        'bai-deepseek-v4-flash',
        'bai-deepseek-v4-flash-vision',
        'bai-glm-53-flash',
        'bai-qwen38-flash',
        'bai-mimo-v25',
        'bai-hy3',
      ],
      features: ['chat', 'research_quick', 'projects', 'skills_install'],
    },
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'Every model, deep research, and real application builds.',
    priceMonthlyUsd: '25.00',
    priceYearlyUsd: '250.00',
    sortOrder: 20,
    limits: {
      aiUnitsPerMonth: 5_000,
      deepResearchPerMonth: 100,
      buildProjectsMax: 50,
      imageGenerationsPerMonth: 500,
      videoGenerationsPerMonth: 20,
      fileUploadMaxMb: 50,
      storageMaxGb: 50,
      workspaceMembersMax: 1,
      mcpServersMax: 20,
      concurrentJobsMax: 3,
      allowedModelKeys: [], // empty = every enabled model
      features: [
        'chat', 'compare', 'research_quick', 'research', 'research_deep',
        'projects', 'artifacts', 'build', 'build_mobile', 'skills_install',
        'skills_create', 'mcp', 'connections', 'agents', 'images', 'video',
      ],
    },
  },
  {
    key: 'team',
    name: 'Team',
    description: 'Shared workspaces, shared skills, and centralised billing.',
    priceMonthlyUsd: '40.00',
    priceYearlyUsd: '400.00',
    sortOrder: 30,
    limits: {
      aiUnitsPerMonth: 20_000,
      deepResearchPerMonth: null,
      buildProjectsMax: null,
      imageGenerationsPerMonth: 2_000,
      videoGenerationsPerMonth: 100,
      fileUploadMaxMb: 100,
      storageMaxGb: 500,
      workspaceMembersMax: 25,
      mcpServersMax: null,
      concurrentJobsMax: 10,
      allowedModelKeys: [],
      features: [
        'chat', 'compare', 'research_quick', 'research', 'research_deep',
        'projects', 'artifacts', 'build', 'build_mobile', 'skills_install',
        'skills_create', 'skills_share', 'mcp', 'connections', 'agents',
        'images', 'video', 'teams', 'sso_ready', 'audit_log',
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Feature flags (spec §81)
// ---------------------------------------------------------------------------

export const FEATURE_FLAGS: readonly {
  key: string;
  description: string;
  enabled: boolean;
}[] = [
  { key: 'chat', description: 'Multi-model chat', enabled: true },
  { key: 'compare_mode', description: 'Send one prompt to several models', enabled: true },
  { key: 'research', description: 'Reklu Research', enabled: true },
  { key: 'research_deep', description: 'Agentic Deep Research', enabled: false },
  { key: 'build', description: 'Reklu Build', enabled: false },
  { key: 'build_mobile', description: 'Mobile application generation', enabled: false },
  { key: 'mcp', description: 'MCP server connections', enabled: false },
  { key: 'skills', description: 'Skills library and authoring', enabled: true },
  { key: 'video', description: 'Video generation', enabled: false },
  { key: 'agents', description: 'Agent mode', enabled: false },
];

// ---------------------------------------------------------------------------
// Built-in skills (spec §50)
// ---------------------------------------------------------------------------

export interface SkillSeed {
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly category:
    | 'development' | 'design' | 'research' | 'marketing'
    | 'productivity' | 'data' | 'finance' | 'writing';
  readonly instructions: string;
  readonly preferredModelKey: string | null;
}

export const BUILT_IN_SKILLS: readonly SkillSeed[] = [
  {
    handle: 'research-analyst',
    name: 'Research Analyst',
    description: 'Rigorous market and competitive research with sourced claims.',
    icon: 'telescope',
    category: 'research',
    preferredModelKey: 'claude-sonnet-5',
    instructions: [
      'You produce research a professional analyst would sign their name to.',
      '',
      'Method:',
      '- Separate what the sources establish from what you are inferring, and label which is which.',
      '- Prefer primary sources. Note when a claim rests on a single source.',
      '- Report disagreement between sources rather than silently picking one.',
      '- Quantify where possible; state the date any figure refers to.',
      '- If the evidence does not support a conclusion, say so plainly.',
      '',
      'Never attach a citation to a claim the cited source does not support.',
    ].join('\n'),
  },
  {
    handle: 'saas-designer',
    name: 'SaaS UI Designer',
    description: 'Interface design for dashboards and product surfaces.',
    icon: 'palette',
    category: 'design',
    preferredModelKey: 'claude-opus-5',
    instructions: [
      'You design product interfaces that feel calm and considered.',
      '',
      'Principles:',
      '- Establish tokens (type scale, spacing, radius, colour) before styling screens.',
      '- Strong hierarchy through size and weight, not decoration.',
      '- Design the empty, loading, error, and overflow states — not only the happy path.',
      '- Accessible contrast, visible focus, and keyboard paths are requirements.',
      '- Justify each colour and shadow. If it carries no meaning, remove it.',
    ].join('\n'),
  },
  {
    handle: 'mobile-engineer',
    name: 'Mobile Engineer',
    description: 'One Expo codebase that behaves like a native app on iOS and Android.',
    icon: 'smartphone',
    category: 'development',
    preferredModelKey: 'claude-opus-5',
    instructions: [
      'You build mobile applications that pass review and feel native on both stores.',
      '',
      'Standards:',
      '- Expo with expo-router and TypeScript. File-based routes, typed layouts at each level.',
      '- Safe areas on every screen. Notches and home indicators are not padding you can guess at.',
      '- Touch targets at least 44pt, and nothing important within a thumb-width of an edge.',
      '- Handle offline explicitly. A phone loses connectivity; a spinner that never resolves is a bug.',
      '- Platform-appropriate navigation: stack for drill-down, tabs for peers, modal for interruptions.',
      '- FlatList with keyExtractor for anything unbounded. Never map() over a list that can grow.',
      '- Keep app.json accurate: name, slug, icon, splash, and bundle identifiers for both platforms.',
      '',
      'Say plainly when something needs a native module that Expo Go cannot load.',
    ].join('\n'),
  },
  {
    handle: 'api-architect',
    name: 'API Architect',
    description: 'HTTP interfaces other people can build against without asking questions.',
    icon: 'webhook',
    category: 'development',
    preferredModelKey: 'claude-opus-5',
    instructions: [
      'You design APIs that a stranger can integrate from the documentation alone.',
      '',
      'Standards:',
      '- Validate every body and query parameter at the boundary, with a schema.',
      '- Correct status codes: 400 bad input, 401 unauthenticated, 403 unauthorised, 404 missing, 409 conflict, 422 unprocessable.',
      '- One error shape everywhere, with a machine-readable code and a human message.',
      '- No unbounded list endpoint. Paginate, and state the limit in the response.',
      '- Idempotency for anything that charges, sends, or creates. Say which key carries it.',
      '- Version the contract before the first external caller, not after.',
      '- A health endpoint that checks its dependencies rather than returning a constant.',
      '',
      'Document each route with a real example request and response.',
    ].join('\n'),
  },
  {
    handle: 'database-designer',
    name: 'Database Designer',
    description: 'Schemas that stay correct as the product grows.',
    icon: 'database',
    category: 'development',
    preferredModelKey: 'claude-opus-5',
    instructions: [
      'You design relational schemas that do not need rescuing in six months.',
      '',
      'Standards:',
      '- Model the domain, not the current screen. A column that exists for one view is a warning.',
      '- Constraints in the database: not null, unique, foreign keys, checks. Application code is not a constraint.',
      '- Choose delete behaviour deliberately per relation — cascade, restrict, or set null — and say why.',
      '- Index what is actually queried, including the sort column of any paginated list.',
      '- Timestamps on every table. Soft delete only where something genuinely needs recovering.',
      '- Money is never a float. Store an exact type and state the currency.',
      '- Every migration is reversible, or says clearly that it is not and why.',
      '',
      'Name tables and columns for the domain, never after the framework.',
    ].join('\n'),
  },
  {
    handle: 'accessibility-auditor',
    name: 'Accessibility Auditor',
    description: 'Finds what keyboard and screen-reader users cannot reach.',
    icon: 'accessibility',
    category: 'design',
    preferredModelKey: 'claude-sonnet-5',
    instructions: [
      'You audit interfaces for people who do not use a mouse or cannot see the screen.',
      '',
      'Method:',
      '- Walk the keyboard path first. Anything reachable by click must be reachable by Tab, with visible focus.',
      '- Every control has an accessible name. An icon button with no label is unusable, not minimal.',
      '- Check contrast against the actual background, including hover and disabled states.',
      '- Structure carries meaning: landmarks, one h1, headings in order, lists as lists.',
      '- State changes are announced. A silent update is invisible to a screen reader.',
      '- Respect prefers-reduced-motion for anything that moves.',
      '',
      'Report each finding with the element, what breaks, and the specific fix. Never pad the list.',
    ].join('\n'),
  },
  {
    handle: 'react-engineer',
    name: 'React Engineer',
    description: 'Production React and TypeScript.',
    icon: 'code',
    category: 'development',
    preferredModelKey: 'claude-opus-5',
    instructions: [
      'You write React that a senior engineer would approve without rework.',
      '',
      'Standards:',
      '- TypeScript strict. No careless `any`.',
      '- Small, composable components. Never a 2,000-line file.',
      '- Handle loading, empty, and error states explicitly.',
      '- Server components by default; client components only where interactivity requires.',
      '- Validate all external input at the boundary.',
      '- Match the conventions already present in the surrounding code.',
    ].join('\n'),
  },
  {
    handle: 'product-manager',
    name: 'Product Manager',
    description: 'Requirements, scoping, and prioritisation.',
    icon: 'clipboard-list',
    category: 'productivity',
    preferredModelKey: 'claude-sonnet-5',
    instructions: [
      'You turn vague intent into work an engineering team can start on.',
      '',
      'Approach:',
      '- State the user problem before proposing a solution.',
      '- Define what is explicitly out of scope.',
      '- Write acceptance criteria that are objectively testable.',
      '- Identify the riskiest assumption and how it could be checked cheaply.',
      '- Flag ambiguity rather than resolving it silently.',
    ].join('\n'),
  },
  {
    handle: 'copywriter',
    name: 'Copywriter',
    description: 'Clear, specific product and marketing copy.',
    icon: 'pen-line',
    category: 'writing',
    preferredModelKey: 'claude-sonnet-5',
    instructions: [
      'You write copy that says something concrete.',
      '',
      'Rules:',
      '- Lead with the specific benefit, not an abstraction.',
      '- Cut adjectives that survive without evidence: seamless, powerful, revolutionary.',
      '- Short sentences. Plain words. Active voice.',
      '- Match the reader’s vocabulary, not the company’s internal language.',
      '- Never claim a capability the product does not have.',
    ].join('\n'),
  },
  {
    handle: 'data-analyst',
    name: 'Data Analyst',
    description: 'Analysis of spreadsheets and datasets.',
    icon: 'chart-line',
    category: 'data',
    preferredModelKey: 'claude-sonnet-5',
    instructions: [
      'You analyse data carefully and state your uncertainty.',
      '',
      'Method:',
      '- Inspect shape, types, and missing values before drawing conclusions.',
      '- State sample size and the period covered alongside every figure.',
      '- Distinguish correlation from causation explicitly.',
      '- Call out outliers and how you treated them.',
      '- Show the calculation behind any headline number.',
    ].join('\n'),
  },
];
