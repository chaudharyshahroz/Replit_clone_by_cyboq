/**
 * The Build Brief (spec §28–29, §38).
 *
 * Reklu interprets the product *before* writing code. The brief is persisted
 * because later edits are reasoned against the product's intent, not
 * re-derived from the original prompt string.
 *
 * The rule that matters most is spec §38: **an example is not the scope.** A
 * prompt mentioning three exercises does not mean a fitness app that supports
 * three exercises. The prompt below says so explicitly, and the brief captures
 * the full feature set rather than the illustrative subset.
 */
import { z } from 'zod';
import type { RegisteredModel, TokenUsage } from '@reklu/ai';
import { getProvider, type ModelMessage } from '@reklu/ai';
import { logger } from '@reklu/shared';

export type BuildTarget = 'website' | 'web_app' | 'mobile_app' | 'api' | 'dashboard';

export const BriefSchema = z.object({
  product: z.string().min(1),
  summary: z.string().min(1),
  target: z.enum(['website', 'web_app', 'mobile_app', 'api', 'dashboard']),
  /** Empty for web-only builds; ['ios','android'] for mobile (spec §37). */
  platforms: z.array(z.enum(['web', 'ios', 'android'])).default([]),
  userRoles: z.array(z.string()).max(8).default([]),
  coreFeatures: z.array(z.string()).max(20).default([]),
  pages: z.array(z.object({ name: z.string(), purpose: z.string() })).max(24).default([]),
  dataModel: z
    .array(z.object({ entity: z.string(), fields: z.array(z.string()).max(20) }))
    .max(20)
    .default([]),
  stack: z.array(z.string()).max(12).default([]),
  integrations: z.array(z.string()).max(10).default([]),
  needsAuth: z.boolean().default(false),
  needsDatabase: z.boolean().default(false),
  /** Anything the brief deliberately excludes, so scope is explicit. */
  outOfScope: z.array(z.string()).max(10).default([]),
});

export type BuildBrief = z.infer<typeof BriefSchema>;

const BRIEF_PROMPT = [
  'You interpret a product request into a concrete build brief. Return JSON only.',
  '',
  'Shape:',
  '{"product":"…","summary":"…","target":"website|web_app|mobile_app|api|dashboard",',
  ' "platforms":["web"|"ios"|"android"],"userRoles":["…"],"coreFeatures":["…"],',
  ' "pages":[{"name":"…","purpose":"…"}],"dataModel":[{"entity":"…","fields":["…"]}],',
  ' "stack":["…"],"integrations":["…"],"needsAuth":true,"needsDatabase":true,',
  ' "outOfScope":["…"]}',
  '',
  'Rules that matter:',
  '- Examples in the request are ILLUSTRATIVE, not the scope. If someone asks for',
  '  a fitness app and mentions three exercises, the product supports many',
  '  exercises — design the complete system, not the example.',
  '- Infer sensible defaults rather than asking questions. A real product of this',
  '  category needs auth, persistence, and error states; include them.',
  '- Every page must have a purpose. Every entity must have fields.',
  '- State what is deliberately out of scope, so the boundary is explicit.',
  '- A marketing site does not need a database. Do not add what is not needed.',
].join('\n');

/** Models wrap JSON in fences and prose; recover the object rather than failing. */
function parseJsonObject(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last <= first) return undefined;
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

/**
 * Parse a model response into a brief.
 *
 * Exported for testing: this is the part most likely to break when a model
 * changes its formatting habits, and it must never throw into a request.
 */
export function parseBrief(raw: string): BuildBrief | undefined {
  const parsed = BriefSchema.safeParse(parseJsonObject(raw));
  return parsed.success ? parsed.data : undefined;
}

/** A heuristic fallback so a malformed brief does not abort the build. */
export function fallbackBrief(prompt: string): BuildBrief {
  const lower = prompt.toLowerCase();
  const target: BuildTarget = /\b(mobile|ios|android|app store)\b/.test(lower)
    ? 'mobile_app'
    : /\b(dashboard|admin|analytics)\b/.test(lower)
      ? 'dashboard'
      : /\b(api|endpoint|backend)\b/.test(lower)
        ? 'api'
        : /\b(landing|marketing|portfolio|website)\b/.test(lower)
          ? 'website'
          : 'web_app';

  return {
    product: prompt.slice(0, 80),
    summary: prompt.slice(0, 400),
    target,
    platforms: target === 'mobile_app' ? ['ios', 'android'] : ['web'],
    userRoles: [],
    coreFeatures: [],
    pages: [],
    dataModel: [],
    stack: stackFor(target),
    integrations: [],
    // A marketing site genuinely does not need these; anything else probably does.
    needsAuth: target !== 'website',
    needsDatabase: target !== 'website',
    outOfScope: [],
  };
}

/** Default stack per target (spec §37 for mobile). */
export function stackFor(target: BuildTarget): string[] {
  switch (target) {
    case 'mobile_app':
      // One codebase targeting both stores, per spec §37.
      return ['Expo', 'React Native', 'TypeScript', 'Expo Router'];
    case 'api':
      return ['Node.js', 'TypeScript', 'Hono'];
    case 'website':
      return ['Next.js', 'TypeScript', 'Tailwind CSS'];
    case 'dashboard':
    case 'web_app':
      return ['Next.js', 'TypeScript', 'Tailwind CSS', 'PostgreSQL'];
  }
}

export interface GenerateBriefOptions {
  readonly prompt: string;
  readonly model: RegisteredModel;
  readonly signal?: AbortSignal;
}

export interface BriefResult {
  readonly brief: BuildBrief;
  /** True when the model's brief could not be parsed and a fallback was used. */
  readonly usedFallback: boolean;
  readonly usage: TokenUsage;
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

/**
 * Produce a brief for a prompt.
 *
 * Never throws: a build that cannot produce a brief should still proceed with a
 * reasonable default rather than failing before anything is attempted.
 */
export async function generateBrief(options: GenerateBriefOptions): Promise<BriefResult> {
  const provider = getProvider(options.model.providerKey);
  if (!provider)
    return { brief: fallbackBrief(options.prompt), usedFallback: true, usage: EMPTY_USAGE };

  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: options.prompt }] },
  ];

  try {
    const result = await provider.generate({
      modelIdentifier: options.model.modelIdentifier,
      messages,
      system: BRIEF_PROMPT,
      maxOutputTokens: 2_000,
      temperature: 0,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const brief = parseBrief(result.text);
    if (brief) return { brief, usedFallback: false, usage: result.usage };

    logger.warn('Build brief could not be parsed; using heuristic fallback');
    return { brief: fallbackBrief(options.prompt), usedFallback: true, usage: result.usage };
  } catch (error) {
    logger.error('Build brief generation failed', { error });
    return { brief: fallbackBrief(options.prompt), usedFallback: true, usage: EMPTY_USAGE };
  }
}

/** Render a brief as the context prefix for code generation. */
export function briefToContext(brief: BuildBrief): string {
  const lines = [
    `Product: ${brief.product}`,
    `Summary: ${brief.summary}`,
    `Target: ${brief.target}${brief.platforms.length > 0 ? ` (${brief.platforms.join(', ')})` : ''}`,
  ];

  if (brief.stack.length > 0) lines.push(`Stack: ${brief.stack.join(', ')}`);
  if (brief.userRoles.length > 0) lines.push(`Users: ${brief.userRoles.join(', ')}`);
  if (brief.coreFeatures.length > 0) {
    lines.push('Features:', ...brief.coreFeatures.map((f) => `  - ${f}`));
  }
  if (brief.pages.length > 0) {
    lines.push('Pages:', ...brief.pages.map((p) => `  - ${p.name}: ${p.purpose}`));
  }
  if (brief.dataModel.length > 0) {
    lines.push(
      'Data model:',
      ...brief.dataModel.map((e) => `  - ${e.entity}(${e.fields.join(', ')})`),
    );
  }
  if (brief.needsAuth) lines.push('Requires authentication.');
  if (brief.needsDatabase) lines.push('Requires a database.');
  if (brief.outOfScope.length > 0) {
    lines.push(`Out of scope: ${brief.outOfScope.join('; ')}`);
  }

  return lines.join('\n');
}
