/**
 * Turning a model's plan into executable steps (spec §62).
 *
 * Same problem as deck parsing: models return something close to JSON, and
 * failing a whole run because a field was named `action` instead of `kind` is
 * a worse outcome than accepting the synonym. What is NOT accepted is a plan
 * with no steps — a run with nothing to do is a failure worth reporting.
 */
import { z } from 'zod';

export const MAX_PLAN_STEPS = 40;

/** What a step does. Unknown kinds become `model`, the least privileged. */
export type StepKind = 'model' | 'tool' | 'research' | 'artifact';

export interface PlannedStep {
  readonly title: string;
  readonly description?: string | undefined;
  readonly kind: StepKind;
  /** Set only for tool steps. */
  readonly toolName?: string | undefined;
}

export interface Plan {
  readonly objective: string;
  readonly steps: readonly PlannedStep[];
}

const KINDS: readonly StepKind[] = ['model', 'tool', 'research', 'artifact'];

const stepSchema = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  step: z.string().optional(),
  description: z.string().optional(),
  detail: z.string().optional(),
  kind: z.string().optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  tool: z.string().optional(),
  toolName: z.string().optional(),
});

const planSchema = z.object({
  objective: z.string().optional(),
  goal: z.string().optional(),
  steps: z.array(stepSchema).optional(),
  plan: z.array(stepSchema).optional(),
});

export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function toKind(raw: string | undefined, hasTool: boolean): StepKind {
  const normalised = raw?.toLowerCase().trim();
  if (normalised && (KINDS as readonly string[]).includes(normalised)) {
    return normalised as StepKind;
  }
  // A step naming a tool is a tool step whatever it called itself.
  if (hasTool) return 'tool';
  if (normalised?.includes('research') || normalised?.includes('search')) return 'research';
  if (normalised?.includes('artifact') || normalised?.includes('document')) return 'artifact';
  // Least privileged default: a model step calls nothing external.
  return 'model';
}

export function parsePlan(raw: string, objective: string): Plan | undefined {
  const parsed = planSchema.safeParse(extractJson(raw));
  if (!parsed.success) return undefined;

  const source = parsed.data.steps ?? parsed.data.plan ?? [];
  const steps: PlannedStep[] = [];

  for (const entry of source) {
    if (steps.length >= MAX_PLAN_STEPS) break;

    const title = (entry.title ?? entry.name ?? entry.step ?? entry.action ?? '').trim();
    if (!title) continue;

    const toolName = (entry.toolName ?? entry.tool)?.trim() || undefined;

    steps.push({
      title: title.slice(0, 200),
      description: (entry.description ?? entry.detail)?.trim() || undefined,
      kind: toKind(entry.kind ?? entry.type, Boolean(toolName)),
      toolName,
    });
  }

  if (steps.length === 0) return undefined;

  return {
    objective: (parsed.data.objective ?? parsed.data.goal ?? '').trim() || objective,
    steps,
  };
}

export const PLAN_PROMPT = `You plan multi-step work for an autonomous agent.

Return ONE JSON object and nothing else:

{
  "objective": "restated goal",
  "steps": [
    { "title": "Short imperative", "description": "what and why", "kind": "model" },
    { "title": "Look something up", "kind": "tool", "toolName": "exact_tool_name" }
  ]
}

Kinds: model (reason or write), tool (call a named tool), research (search the
web), artifact (produce a document or deck).

Plan the fewest steps that actually achieve the objective. Do not pad. Only use
"tool" with a tool name you were told exists — never invent one.`;
