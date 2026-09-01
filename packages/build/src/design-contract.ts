import type { BuildBrief } from './brief';
import { chooseDirection, describeDirection } from './design-intelligence';
import type { SitePlan } from './market-research';

export interface DesignContract {
  readonly concept: string;
  readonly userOutcome: string;
  readonly narrative: readonly string[];
  readonly contentPolicy: readonly string[];
  readonly acceptance: readonly string[];
}

/** A stable art-direction brief shared by the builder, director and critic. */
export function createDesignContract(brief: BuildBrief, strategy?: SitePlan): DesignContract {
  const direction = chooseDirection(brief);
  const website = brief.target === 'website';
  const researchedConcept = strategy
    ? [
        strategy.theme.mood,
        `${strategy.theme.palette} palette`,
        `${strategy.theme.typography} typography`,
        `${strategy.theme.imagery} imagery`,
        strategy.theme.shape,
        strategy.theme.density,
        strategy.theme.motion,
      ].filter(Boolean).join(' · ')
    : undefined;

  return {
    concept: researchedConcept
      ? `${researchedConcept}. This research-derived business direction overrides a generic catalogue style where they conflict.`
      : describeDirection(direction),
    userOutcome: website
      ? `Understand why ${brief.product} is distinctive and reach a meaningful primary action.`
      : `Understand the product's hierarchy and complete its primary task without guessing.`,
    narrative: website
      ? [
          ...(strategy?.audience
            ? [`Design first for ${strategy.audience.primary}: ${strategy.audience.intent}`]
            : []),
          'A specific opening promise with useful supporting copy and one primary action.',
          'Tangible proof: products, services, outcomes, craft, numbers or recognizable details.',
          'A human story or trust signal that belongs to this product.',
          'A concrete closing action with location, purchase, booking or contact context.',
        ]
      : [
          'Orient the user and make the primary task obvious.',
          'Show realistic content that demonstrates the core workflow.',
          'Make success, empty, loading and error states intentional and compact.',
        ],
    contentPolicy: [
      'Preview mode uses realistic representative content; it must not look like an unconfigured database.',
      'Never use lorem ipsum, generic company claims, placeholder identities, or raw developer-facing copy.',
      ...(website
        ? [
            'Do not present “no products”, “no testimonials”, “nothing here” or similar empty states as marketing sections.',
            'If live data is unavailable, render curated preview fixtures that demonstrate the intended finished experience.',
          ]
        : []),
    ],
    acceptance: [
      ...(strategy?.conversion
        ? [
            `The dominant action is “${strategy.conversion.primaryAction}”; supporting actions are visually quieter.`,
            ...strategy.conversion.proof.map((item) => `The design makes this proof tangible: ${item}`),
          ]
        : []),
      'The first viewport contains meaningful content, a clear heading and an actionable next step.',
      'No section is viewport-height merely to center a small amount of copy.',
      'Typography, spacing, surfaces and interaction states use one coherent token system.',
      'Primitive, semantic and component tokens form one chain; components do not bypass it with unrelated colors, radii or shadows.',
      'The compiled stylesheet contains every utility system used by the markup; an HTTP-successful but unstyled page is a failed design.',
      'Hero text, navigation and the primary action remain visible above imagery at desktop and mobile widths.',
      'The page remains readable and usable at 360px without horizontal overflow.',
      'Text contrast, keyboard focus, labels and reduced-motion behavior are explicit.',
    ],
  };
}

export function designContractPrompt(contract: DesignContract): string {
  return [
    '',
    'Design contract — this is the acceptance contract for the finished interface:',
    `Concept: ${contract.concept}`,
    `User outcome: ${contract.userOutcome}`,
    '',
    'Narrative:',
    ...contract.narrative.map((item) => `- ${item}`),
    '',
    'Content policy:',
    ...contract.contentPolicy.map((item) => `- ${item}`),
    '',
    'Acceptance checks:',
    ...contract.acceptance.map((item) => `- ${item}`),
  ].join('\n');
}
