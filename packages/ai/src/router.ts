/**
 * Reklu Auto — automatic model selection (spec §12).
 *
 * Two stages, deliberately separated:
 *
 *   classify()  request  → RequestProfile   (what does this task need?)
 *   route()     profile  → RoutingDecision  (which model best supplies it?)
 *
 * Routing is rule-based today. The split exists so a learned router can replace
 * `score()` without touching classification, the callers, or the persisted
 * `routingReason` that users see.
 *
 * Every decision carries a human-readable reason. A router that cannot explain
 * itself is one users stop trusting the moment it picks badly.
 */
import type { PlanLimits } from '@reklu/database';
import type { ModelMessage } from './types';
import type { RegisteredModel } from './registry';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type RequestIntent =
  | 'quick' // short factual or conversational turn
  | 'general'
  | 'reasoning' // multi-step logic, maths, planning
  | 'coding'
  | 'research'
  | 'long_context' // large input to digest
  | 'vision';

export interface RequestProfile {
  readonly intent: RequestIntent;
  readonly needsVision: boolean;
  readonly needsTools: boolean;
  readonly estimatedInputTokens: number;
  /** 0–1. Drives how much capability is worth paying for. */
  readonly complexity: number;
}

/** Cheap heuristic; the exact divisor matters less than being consistent. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const CODING_SIGNALS =
  /\b(code|function|class|bug|refactor|typescript|javascript|python|rust|api|sql|regex|compile|stack trace|npm|git)\b|```/i;
const REASONING_SIGNALS =
  /\b(why|prove|derive|analy[sz]e|compare|trade-?off|strategy|plan|architect|evaluate|calculate|solve|reason)\b/i;
const RESEARCH_SIGNALS =
  /\b(research|sources?|cite|citation|market|competitor|latest|news|study|evidence|according to)\b/i;

/** Short, closed questions that do not need an expensive model. */
const QUICK_SIGNALS = /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no)\b/i;

export function classify(params: {
  readonly messages: readonly ModelMessage[];
  readonly system?: string | undefined;
  readonly hasTools?: boolean;
}): RequestProfile {
  const { messages, system, hasTools = false } = params;

  const allText = messages
    .flatMap((m) => m.content)
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');

  const latestUserText =
    [...messages]
      .reverse()
      .find((m) => m.role === 'user')
      ?.content.filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join(' ') ?? '';

  const needsVision = messages.some((m) =>
    m.content.some((part) => part.type === 'image' || part.type === 'file'),
  );

  const estimatedInputTokens = estimateTokens(allText) + estimateTokens(system ?? '');

  // Order matters: the more specific signal wins.
  let intent: RequestIntent = 'general';
  if (needsVision) intent = 'vision';
  else if (estimatedInputTokens > 32_000) intent = 'long_context';
  else if (CODING_SIGNALS.test(latestUserText)) intent = 'coding';
  else if (RESEARCH_SIGNALS.test(latestUserText)) intent = 'research';
  else if (REASONING_SIGNALS.test(latestUserText)) intent = 'reasoning';
  else if (QUICK_SIGNALS.test(latestUserText.trim()) || latestUserText.trim().length < 80) {
    intent = 'quick';
  }

  // Length and conversation depth both raise the value of a stronger model.
  const lengthFactor = Math.min(1, latestUserText.length / 1_200);
  const depthFactor = Math.min(1, messages.length / 20);
  const intentFloor: Record<RequestIntent, number> = {
    quick: 0.05,
    general: 0.35,
    vision: 0.5,
    research: 0.6,
    coding: 0.7,
    long_context: 0.7,
    reasoning: 0.8,
  };
  const complexity = Math.min(
    1,
    Math.max(intentFloor[intent], lengthFactor * 0.5 + depthFactor * 0.2),
  );

  return { intent, needsVision, needsTools: hasTools, estimatedInputTokens, complexity };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoutingDecision {
  readonly model: RegisteredModel;
  /** Shown to the user and persisted on `ai_requests.routingReason`. */
  readonly reason: string;
  readonly profile: RequestProfile;
  readonly alternatives: readonly RegisteredModel[];
}

export class NoEligibleModelError extends Error {
  readonly requirements: readonly string[];
  constructor(requirements: readonly string[]) {
    super(`No available model satisfies: ${requirements.join(', ')}`);
    this.name = 'NoEligibleModelError';
    this.requirements = requirements;
  }
}

const SPEED_BONUS: Record<RegisteredModel['speed'], number> = {
  fast: 1,
  balanced: 0.5,
  slow: 0,
};
const COST_RANK: Record<RegisteredModel['costTier'], number> = {
  economy: 0,
  standard: 1,
  premium: 2,
};

/** Which `bestFor` tags satisfy each intent. */
const INTENT_TAGS: Record<RequestIntent, readonly string[]> = {
  quick: ['quick', 'summarization', 'classification'],
  general: ['general'],
  reasoning: ['reasoning', 'analysis', 'math'],
  coding: ['coding'],
  research: ['research', 'analysis', 'current-events'],
  long_context: ['long-context', 'document-analysis'],
  vision: ['vision'],
};

/**
 * Score a candidate for a profile. Higher wins.
 *
 * This function is the intended replacement point for a learned router.
 */
export function score(model: RegisteredModel, profile: RequestProfile): number {
  let total = 0;

  // Capability match against the model's declared strengths.
  const tags = INTENT_TAGS[profile.intent];
  const matched = tags.filter((tag) => model.bestFor.includes(tag)).length;
  total += matched * 30;

  // Admin-controlled preference ordering.
  total += model.routingPriority * 0.4;

  // Complexity: pay for capability only when the task justifies it.
  const cost = COST_RANK[model.costTier];
  if (profile.complexity >= 0.7) {
    total += cost * 25; // hard task — prefer stronger
  } else if (profile.complexity <= 0.25) {
    total += (2 - cost) * 30; // trivial task — prefer cheap
    total += SPEED_BONUS[model.speed] * 20;
  } else {
    total += (1 - Math.abs(cost - 1)) * 12; // middling — prefer standard tier
  }

  // Reasoning models earn their latency only on genuinely hard work.
  if (model.supportsReasoning) {
    total += profile.complexity >= 0.7 ? 20 : -12;
  }

  // Headroom: heavily penalize a window that barely fits, since the reply and
  // any tool results still have to land inside it.
  const required = profile.estimatedInputTokens * 1.5 + model.maxOutputTokens;
  if (model.contextWindow < required) total -= 60;
  else if (model.contextWindow >= profile.estimatedInputTokens * 4) total += 10;

  if (profile.intent === 'long_context') {
    total += Math.min(30, model.contextWindow / 40_000);
  }

  return total;
}

export interface RouteOptions {
  readonly profile: RequestProfile;
  readonly candidates: readonly RegisteredModel[];
  readonly limits?: PlanLimits | undefined;
}

/**
 * Choose a model.
 *
 * Hard requirements are filters, not score penalties: a model that cannot see
 * an image must never be selected for a request containing one, no matter how
 * well it scores otherwise.
 */
export function route(options: RouteOptions): RoutingDecision {
  const { profile, candidates } = options;

  const requirements: string[] = [];
  if (profile.needsVision) requirements.push('vision');
  if (profile.needsTools) requirements.push('tool use');

  const eligible = candidates.filter((model) => {
    if (!model.isConfigured) return false;
    if (profile.needsVision && !model.supportsVision) return false;
    if (profile.needsTools && !model.supportsTools) return false;
    return true;
  });

  if (eligible.length === 0) {
    // Fall back to the mock only if it is the sole thing available; otherwise
    // report honestly rather than silently downgrading the user's request.
    const mock = candidates.find((m) => m.isDevelopmentMock);
    if (mock && candidates.every((m) => m.isDevelopmentMock || !m.isConfigured)) {
      return {
        model: mock,
        reason: 'No AI provider is configured — using the development mock.',
        profile,
        alternatives: [],
      };
    }
    throw new NoEligibleModelError(requirements.length > 0 ? requirements : ['an available model']);
  }

  const ranked = [...eligible]
    .map((model) => ({ model, value: score(model, profile) }))
    .sort((a, b) => b.value - a.value || b.model.routingPriority - a.model.routingPriority);

  const winner = ranked[0]!.model;

  return {
    model: winner,
    reason: explain(winner, profile),
    profile,
    alternatives: ranked.slice(1, 4).map((entry) => entry.model),
  };
}

function explain(model: RegisteredModel, profile: RequestProfile): string {
  if (model.isDevelopmentMock) {
    return 'No AI provider is configured — using the development mock.';
  }

  const because: Record<RequestIntent, string> = {
    quick: 'this is a short request, so Reklu chose a fast, low-cost model',
    general: 'this is a general request',
    reasoning: 'this needs multi-step reasoning',
    coding: 'this is a programming task',
    research: 'this needs research and source analysis',
    long_context: `this input is large (~${profile.estimatedInputTokens.toLocaleString()} tokens), so Reklu chose a large-context model`,
    vision: 'this request includes an image or file, so Reklu chose a multimodal model',
  };

  return `${model.displayName}: ${because[profile.intent]}.`;
}

/** Convenience: classify and route in one call. */
export function autoSelect(params: {
  readonly messages: readonly ModelMessage[];
  readonly system?: string | undefined;
  readonly hasTools?: boolean;
  readonly candidates: readonly RegisteredModel[];
  readonly limits?: PlanLimits | undefined;
}): RoutingDecision {
  const profile = classify({
    messages: params.messages,
    system: params.system,
    hasTools: params.hasTools ?? false,
  });
  return route({ profile, candidates: params.candidates, limits: params.limits });
}
