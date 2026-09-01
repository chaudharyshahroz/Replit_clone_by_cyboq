/**
 * Looking at what already exists before building something new.
 *
 * Asked for a coffee shop landing page, a model writes the coffee shop landing
 * page it has always written: hero, three feature cards, a form. It has no idea
 * what the good ones in that trade actually do — that specialty roasters lead
 * with provenance, that a neighbourhood cafe lives or dies on hours and a map,
 * that a menu people can read beats a menu people download.
 *
 * So the brief is researched before it is built, and what comes back is not
 * prose for a person to read and act on. It is a plan: which pages, which
 * sections in which order, and what the thing should feel like. The model that
 * writes the site is given that instead of being asked to imagine it.
 *
 * Two rules this must not break. It never invents a competitor — the research
 * pipeline carries real sources and strips citation markers a model made up,
 * and that property is the reason to route through it rather than simply asking
 * a model what competitors do. And when no search provider is configured it
 * says so and builds anyway, because a site nobody researched is worth more
 * than no site at all.
 */
import { z } from 'zod';
import type { RegisteredModel } from '@reklu/ai';
import { getProvider } from '@reklu/ai';
import { logger } from '@reklu/shared';
import type { BuildBrief } from './brief';

/** What a site should contain, decided from what comparable sites contain. */
export const SitePlanSchema = z.object({
  audience: z
    .object({
      primary: z.string().min(1),
      intent: z.string().min(1),
      objections: z.array(z.string()).max(6).default([]),
    })
    .optional(),
  /** What this kind of site is expected to have, in the words of the trade. */
  conventions: z.array(z.string()).max(8).default([]),
  /** Observed patterns, never companies invented from model memory. */
  competitorPatterns: z.array(z.string()).max(8).default([]),
  /** Where the good ones differ from each other, which is where a choice exists. */
  differentiators: z.array(z.string()).max(6).default([]),
  pages: z
    .array(
      z.object({
        path: z.string().min(1),
        name: z.string().min(1),
        purpose: z.string().min(1),
        sections: z.array(z.string()).min(1).max(12),
      }),
    )
    .min(1)
    .max(8),
  /** Not a palette. The feeling, from which a palette follows. */
  theme: z.object({
    mood: z.string().min(1),
    palette: z.string().min(1),
    typography: z.string().min(1),
    imagery: z.string().min(1),
    shape: z.string().optional(),
    density: z.string().optional(),
    motion: z.string().optional(),
  }),
  conversion: z
    .object({
      primaryAction: z.string().min(1),
      supportingActions: z.array(z.string()).max(4).default([]),
      proof: z.array(z.string()).max(6).default([]),
    })
    .optional(),
});

export type SitePlan = z.infer<typeof SitePlanSchema>;

export interface BuildResearch {
  readonly plan: SitePlan;
  /** The prose, with its real citations, shown to the person who asked. */
  readonly report: string;
  readonly sourcesUsed: number;
}

/**
 * What to go and find out.
 *
 * Aimed at the trade rather than the product. Searching for one business
 * returns that business; searching for what its kind of site is expected to
 * contain returns the convention, which is what a plan is built from.
 */
export function researchQuestion(brief: BuildBrief): string {
  return [
    `Analyze strong, currently active websites comparable to ${brief.product}.`,
    'Find real business sites rather than template galleries. Compare their audience, visitor intent,',
    'navigation, pages, section order, primary calls to action, proof, content density, typography,',
    'imagery, layout patterns, mobile experience and performance choices. Identify conventions worth',
    'keeping, repeated weaknesses worth avoiding, and a defensible opportunity for this specific site.',
  ].join(' ');
}

const PLAN_PROMPT = [
  'You turn research about a kind of website into a plan for one specific site.',
  '',
  'Return JSON only, matching the schema you are given.',
  '',
  'Rules:',
  '- Every page and section must be justified by the research or by the brief.',
  '  Do not add a page because sites often have one; add it because this site needs it.',
  '- Order the sections the way a visitor needs them, not the way a template lists them.',
  '- `theme` describes a feeling and its consequences, not hex codes. The build has its',
  '  own design standards and will choose colours; what it needs from you is direction.',
  '- `competitorPatterns` must be observable in the supplied research. Do not use model memory.',
  '- State one primary conversion action. Supporting actions must remain visually secondary.',
  '- Audience intent and objections must change the section order or content, not decorate the JSON.',
  '- Name no company you did not read about in the research.',
].join('\n');

/**
 * Turn a research report into a plan the generator can build from.
 *
 * Separate from the research itself because they want different things: the
 * report is written for a person, at length, with citations; the plan is a
 * structure, and asking one call to produce both gets a worse version of each.
 */
export async function planFromResearch(params: {
  readonly brief: BuildBrief;
  readonly report: string;
  readonly model: RegisteredModel;
}): Promise<SitePlan | undefined> {
  const provider = getProvider(params.model.providerKey);
  if (!provider) return undefined;

  try {
    const result = await provider.generate({
      modelIdentifier: params.model.modelIdentifier,
      system: PLAN_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Brief: ${params.brief.product} — ${params.brief.summary}`,
                params.brief.coreFeatures.length
                  ? `It must support: ${params.brief.coreFeatures.join(', ')}`
                  : '',
                '',
                'Research:',
                params.report,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
      ],
      maxOutputTokens: 3_000,
    });

    return SitePlanSchema.parse(parseJson(result.text));
  } catch (error) {
    /*
     * A plan that could not be produced is not a build that should fail. The
     * brief alone still describes a site, and that is how every build worked
     * before this existed.
     */
    logger.warn('Could not turn research into a site plan', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/** Models wrap JSON in fences and prose; recover the object rather than failing. */
function parseJson(raw: string): unknown {
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
 * The plan, as instructions for the generator.
 *
 * Written as a brief a person could follow, because that is what a model
 * follows best — a list of pages with their sections in order, and a paragraph
 * about how the thing should feel.
 */
export function planToPrompt(plan: SitePlan): string {
  const pages = plan.pages
    .map(
      (page) =>
        `${page.path} — ${page.name}: ${page.purpose}\n` +
        page.sections.map((section, index) => `  ${index + 1}. ${section}`).join('\n'),
    )
    .join('\n\n');

  return [
    'Website Strategist brief — competitor evidence and the user request produced this plan. Build it.',
    '',
    plan.audience
      ? `Audience: ${plan.audience.primary}\nIntent: ${plan.audience.intent}${
          plan.audience.objections.length
            ? `\nObjections to resolve: ${plan.audience.objections.join('; ')}`
            : ''
        }`
      : '',
    plan.conversion
      ? `Primary conversion: ${plan.conversion.primaryAction}\nSupporting actions: ${plan.conversion.supportingActions.join(', ') || 'none'}\nProof required: ${plan.conversion.proof.join('; ') || 'specific evidence from the brief'}`
      : '',
    '',
    'Pages and sections, in this order:',
    '',
    pages,
    '',
    `Feel: ${plan.theme.mood}`,
    `Colour: ${plan.theme.palette}`,
    `Type: ${plan.theme.typography}`,
    `Imagery: ${plan.theme.imagery}`,
    plan.theme.shape ? `Shape language: ${plan.theme.shape}` : '',
    plan.theme.density ? `Density: ${plan.theme.density}` : '',
    plan.theme.motion ? `Motion: ${plan.theme.motion}` : '',
    '',
    'Design-system implementation:',
    '- Define primitive tokens for the raw palette, spacing, type scale, radii, shadows and motion.',
    '- Map them to semantic tokens for background, surface, text, primary, accent, border and states.',
    '- Components consume semantic/component tokens; do not scatter raw values through components.',
    '- Use one spacing rhythm, one icon family, explicit hover/focus/active/disabled states, and a',
    '  mobile-first layout that remains composed at 360, 768, 1024 and 1440px.',
    plan.competitorPatterns.length
      ? `\nPatterns observed across comparable sites:\n${plan.competitorPatterns
          .map((item) => `- ${item}`)
          .join('\n')}`
      : '',
    plan.differentiators.length
      ? `\nWhere comparable sites are weak, and this one should not be:\n${plan.differentiators
          .map((item) => `- ${item}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
