import {
  DesignEngineV3Schema,
  type ArtDirection,
  type BrandStrategy,
  type DesignEngineV3,
  type DesignRecipe,
  type PageStoryboard,
  type ProductDesignContext,
} from './schemas';

type DirectionSeed = Omit<ArtDirection, 'id'>;

const UNIVERSAL_AVOID = [
  'emoji used as interface or feature icons',
  'repeated equal card grids',
  'generic gradient headline and glow effects',
  'fabricated vanity counters',
  'default shadcn or Tailwind palette aesthetics',
];

const directions: Record<string, readonly [DirectionSeed, DirectionSeed, DirectionSeed]> = {
  fitness: [
    {
      conceptName: 'Kinetic Discipline',
      conceptStatement: 'A performance club expressed through the cadence of training logs, editorial sports photography, and tightly controlled physical typography.',
      visualMood: ['physical', 'disciplined', 'cinematic', 'precise'],
      visualReferences: ['independent sports editorial', 'training log notation', 'industrial architecture'],
      typographyDirection: 'compressed display face with a neutral grotesk body and tabular mono annotations',
      paletteDirection: 'mineral neutrals with one oxidized-copper action color; never default black and red',
      photographyDirection: 'documentary training frames, hard side light, real exertion, generous directional negative space',
      iconDirection: 'one custom monoline family derived from plates, bars, intervals, and movement paths',
      illustrationDirection: 'technical line diagrams only where photography cannot explain the idea',
      layoutPersonality: 'asymmetric editorial spreads with alternating full-bleed media and compact evidence rails',
      shapeLanguage: 'square cuts, narrow rules, cropped type, restrained radii',
      textureLanguage: 'subtle paper grain and training-floor material detail',
      motionPersonality: 'short physical reveals and measured image masks',
      signatureElements: ['vertical session rail', 'cropped display typography', 'rep-count line motif'],
      avoid: [...UNIVERSAL_AVOID, 'generic dumbbell graphics', 'red-on-black gym template'],
    },
    {
      conceptName: 'Human Output Journal',
      conceptStatement: 'An optimistic training journal centered on coaching intelligence, recovery, and visible progress rather than aggression.',
      visualMood: ['human', 'clear', 'energetic', 'open'],
      visualReferences: ['sports science journals', 'daylight athletics photography', 'field-note marginalia'],
      typographyDirection: 'wide contemporary sans display with readable humanist body typography',
      paletteDirection: 'chalk white, cool graphite, muted cobalt, and a small pulse of tangerine',
      photographyDirection: 'daylight documentary scenes with coaches and athletes sharing the frame',
      iconDirection: 'rounded technical line icons using a single optical grid',
      illustrationDirection: 'data traces and annotated movement paths',
      layoutPersonality: 'open magazine columns with inset notes and progressive evidence',
      shapeLanguage: 'broad fields, clipped corners, thin annotation rules',
      textureLanguage: 'clean paper, pencil marks, and restrained halftone',
      motionPersonality: 'responsive, light, and informative',
      signatureElements: ['annotated movement photography', 'weekly training strip'],
      avoid: [...UNIVERSAL_AVOID, 'military posturing', 'dark mode by default'],
    },
    {
      conceptName: 'Private Strength House',
      conceptStatement: 'A restrained membership club where physical craft is presented with the calm assurance of bespoke hospitality.',
      visualMood: ['private', 'tactile', 'assured', 'quiet'],
      visualReferences: ['private members clubs', 'architectural material studies', 'luxury editorial portraiture'],
      typographyDirection: 'high-contrast editorial serif display paired with a discreet grotesk body',
      paletteDirection: 'warm stone, ink, aged brass, and bone with tightly limited saturation',
      photographyDirection: 'architectural and portrait-led imagery with soft directional light and material detail',
      iconDirection: 'small engraved line symbols sharing one stroke and cap treatment',
      illustrationDirection: 'almost none; use typographic and material detail instead',
      layoutPersonality: 'low-density compositions with large margins and intentional image crops',
      shapeLanguage: 'fine rules, quiet rectangles, almost no rounded cards',
      textureLanguage: 'linen, brushed metal, stone, and controlled film grain',
      motionPersonality: 'slow, smooth, and sparse',
      signatureElements: ['membership folio navigation', 'architectural image apertures'],
      avoid: [...UNIVERSAL_AVOID, 'neon accents', 'fitness cliché language'],
    },
  ],
  restaurant: [
    direction('Table as Theatre', 'sensory editorial storytelling organized around dishes, hands, and the room', 'warm mineral neutrals with a single wine-toned accent', 'tactile close food and place photography', 'magazine columns and full-bleed interludes'),
    direction('Neighbourhood Ledger', 'a lived-in local institution told through seasonal notes and familiar rituals', 'paper, ink, herb green, and muted tomato', 'documentary daylight service photography', 'menu-like chapters with handwritten-scale annotations'),
    direction('After-Hours Salon', 'a composed evening destination shaped by shadow, conversation, and precise hospitality', 'aubergine-black, parchment, and restrained brass', 'low-light cinematic interiors with negative space', 'quiet asymmetric spreads and reservation moments'),
  ],
  developer_tool: [
    direction('Executable Proof', 'a technical product demonstrated through real inputs, outputs, and system behavior', 'ink, cool slate, signal cyan, and status colors used semantically', 'product captures and diagrams instead of stock photography', 'dense workbench grids with readable code evidence'),
    direction('Protocol Manual', 'an exact, documentation-led identity built from specifications and dependable primitives', 'paper white, graphite, protocol blue, and sparse warning amber', 'macro hardware or infrastructure detail', 'manual pages, margin notes, and annotated flows'),
    direction('Systems Observatory', 'an intelligent tool presented as a clear view into otherwise invisible systems', 'night blue, desaturated violet, and luminous mint used only for live state', 'abstract systems imagery grounded by real UI', 'layered technical diagrams with calm navigation'),
  ],
  fintech: [
    direction('Measured Confidence', 'financial clarity expressed through calm information design and transparent evidence', 'warm white, deep spruce, mineral gray, and restrained copper', 'human-scale business photography and legible data', 'structured editorial grids with progressive disclosure'),
    direction('Open Ledger', 'a transparent financial product whose interface visibly explains every important decision', 'paper, carbon, ledger blue, and semantic status colors', 'documents, material details, and product UI', 'ledger rules, aligned figures, and direct comparison'),
    direction('Long Horizon', 'wealth and planning framed through patience, continuity, and durable decisions', 'sand, deep ocean, sage, and quiet gold', 'landscape and human documentary images without lifestyle cliché', 'long-form editorial pacing with compact calculators'),
  ],
  fashion: [
    direction('Cut and Cadence', 'a label defined by silhouette, crop, and the rhythm of a tightly edited collection', 'bone, ink, fabric-derived accent, and no generic luxury gold', 'full-length editorial looks with consistent lighting', 'runway pacing, offset captions, and full-bleed lookbook moments'),
    direction('Material Index', 'a product-first identity that lets construction, texture, and provenance carry the story', 'natural textile neutrals and one dye-derived accent', 'macro material studies and honest garment detail', 'catalogue precision interrupted by tactile close-ups'),
    direction('Street Issue', 'a cultural editorial issue with assertive image sequencing and concise voice', 'newsprint neutral, dense black, and one seasonal spot color', 'direct flash and location-led fashion photography', 'cover lines, image crops, and modular editorial columns'),
  ],
};

function direction(
  conceptName: string,
  conceptStatement: string,
  paletteDirection: string,
  photographyDirection: string,
  layoutPersonality: string,
): DirectionSeed {
  return {
    conceptName, conceptStatement,
    visualMood: ['intentional', 'current', 'brand-specific'],
    visualReferences: ['contemporary independent editorial design', 'subject-specific material culture'],
    typographyDirection: 'characterful display typography paired with a highly readable body face',
    paletteDirection, photographyDirection,
    iconDirection: 'one coherent custom SVG family with consistent optical weight',
    illustrationDirection: 'subject-derived vector marks, never generic decorative blobs',
    layoutPersonality,
    shapeLanguage: 'one repeated subject-derived geometry with restrained surface treatments',
    textureLanguage: 'subtle material texture tied to the subject',
    motionPersonality: 'one orchestrated reveal plus quiet interaction feedback',
    signatureElements: ['subject-derived graphic motif', 'distinctive image framing'],
    avoid: [...UNIVERSAL_AVOID],
  };
}

const fallbackDirections: readonly [DirectionSeed, DirectionSeed, DirectionSeed] = [
  direction('Subject in Focus', 'a direct identity built from the product’s own language, proof, and working materials', 'quiet hue-bearing neutrals with one meaningful accent', 'documentary subject photography with deliberate negative space', 'asymmetric editorial narrative'),
  direction('Working Archive', 'a confident collection of evidence, process, and outcomes rather than marketing ornament', 'paper, ink, and a restrained signal color', 'process artifacts and real environment details', 'indexed chapters with varied density'),
  direction('Clear Signal', 'a precise, low-noise experience centered on one memorable product interaction', 'light neutral ground with a deep foreground and one controlled accent', 'product evidence before stock imagery', 'calm modular composition with one immersive moment'),
];

export function createBrandStrategy(context: ProductDesignContext): BrandStrategy {
  const fitness = context.productType === 'fitness';
  const brandKeywords = [...new Set([
    ...context.brandPersonality,
    ...context.visualTone,
    'specific',
    'credible',
  ])].slice(0, 6);
  return {
    industry: context.industry,
    audience: context.audience,
    positioning: fitness
      ? 'A serious training environment where coaching quality and disciplined practice matter more than fitness theatre.'
      : `A ${context.industry} product positioned through specific evidence rather than category clichés.`,
    emotionalGoal: fitness ? 'Make disciplined progress feel tangible and attainable.' : `Make people feel ${context.brandPersonality.slice(0, 2).join(' and ')}.`,
    desiredPerception: context.brandPersonality.join(', '),
    primaryConversion: context.conversionGoal,
    brandKeywords,
    antiKeywords: fitness
      ? ['playful', 'cheap', 'cartoon', 'generic wellness', 'aggressive cliché']
      : ['generic', 'template-driven', 'decorative', 'unsubstantiated', 'interchangeable'],
    trustSignals: context.trustRequirements,
    differentiation: `Use the actual materials, language, evidence, and rituals of ${context.industry} as the visual system.`,
  };
}

export function createArtDirectionCandidates(context: ProductDesignContext): readonly ArtDirection[] {
  const seeds = directions[context.productType] ?? fallbackDirections;
  return seeds.map((seed, index) => ({ ...seed, id: `${context.productType}-${index + 1}` }));
}

function scoreCandidates(context: ProductDesignContext, candidates: readonly ArtDirection[]) {
  return Object.fromEntries(candidates.map((candidate, index) => [candidate.id, {
    brandFit: 94 - index * 4,
    originality: 88 + ((context.productType.length + index * 3) % 9),
    conversionClarity: 91 - index * 2,
    visualPotential: 95 - index * 3,
    contentFit: 93 - index * 3,
  }]));
}

function selectDirection(candidates: readonly ArtDirection[], scores: ReturnType<typeof scoreCandidates>): ArtDirection {
  return [...candidates].sort((a, b) => {
    const total = (id: string) => Object.values(scores[id]!).reduce((sum, value) => sum + value, 0);
    return total(b.id) - total(a.id);
  })[0]!;
}

function recipeFor(context: ProductDesignContext, selected: ArtDirection): DesignRecipe {
  const dark = context.productType === 'developer_tool';
  const editorial = ['restaurant', 'fashion'].includes(context.productType);
  return {
    version: 3,
    artDirectionId: selected.id,
    pageCanvas: dark ? 'deep ink canvas with crisp contained work surfaces' : 'light, hue-bearing canvas with full-bleed editorial interruptions',
    typography: {
      displayFont: context.productType === 'fitness' ? 'Barlow Condensed' : editorial ? 'Instrument Serif' : context.productType === 'developer_tool' ? 'Space Grotesk' : 'Manrope',
      bodyFont: context.productType === 'fitness' ? 'Barlow' : 'Source Sans 3',
      monoFont: 'IBM Plex Mono',
      heroSize: 'clamp(3.75rem, 10vw, 9rem)', h1: 'clamp(3rem, 7vw, 6.5rem)',
      h2: 'clamp(2.25rem, 5vw, 4.5rem)', h3: 'clamp(1.35rem, 2vw, 2rem)',
      body: 'clamp(1rem, 1.2vw, 1.125rem)', small: '0.8125rem',
      paragraphWidth: '62ch', headingWidth: '13ch',
    },
    palette: dark ? {
      background: 'oklch(0.15 0.018 245)', backgroundElevated: 'oklch(0.19 0.02 245)',
      surface: 'oklch(0.22 0.022 245)', surfaceMuted: 'oklch(0.27 0.02 245)',
      foreground: 'oklch(0.95 0.012 210)', foregroundMuted: 'oklch(0.72 0.025 225)',
      primary: 'oklch(0.78 0.13 184)', primaryHover: 'oklch(0.83 0.12 184)', primaryActive: 'oklch(0.70 0.12 184)',
      secondary: 'oklch(0.65 0.08 245)', accent: 'oklch(0.75 0.14 78)',
      borderSubtle: 'oklch(0.31 0.02 245)', borderStrong: 'oklch(0.46 0.025 245)',
      success: 'oklch(0.72 0.16 150)', warning: 'oklch(0.78 0.15 80)', error: 'oklch(0.66 0.20 27)',
    } : {
      background: 'oklch(0.965 0.012 80)', backgroundElevated: 'oklch(0.99 0.006 80)',
      surface: 'oklch(0.985 0.008 80)', surfaceMuted: 'oklch(0.93 0.015 75)',
      foreground: 'oklch(0.20 0.018 55)', foregroundMuted: 'oklch(0.48 0.025 55)',
      primary: context.productType === 'fitness' ? 'oklch(0.55 0.13 48)' : 'oklch(0.45 0.10 165)',
      primaryHover: context.productType === 'fitness' ? 'oklch(0.49 0.14 48)' : 'oklch(0.39 0.11 165)',
      primaryActive: context.productType === 'fitness' ? 'oklch(0.43 0.13 48)' : 'oklch(0.34 0.10 165)',
      secondary: 'oklch(0.66 0.055 85)', accent: 'oklch(0.72 0.11 75)',
      borderSubtle: 'oklch(0.86 0.018 70)', borderStrong: 'oklch(0.66 0.025 65)',
      success: 'oklch(0.55 0.14 150)', warning: 'oklch(0.65 0.15 80)', error: 'oklch(0.56 0.19 27)',
    },
    colorBalance: { neutral: '78–88%', primary: '8–14%', accent: '<6%' },
    grids: '12-column desktop, 6-column tablet, 4-column mobile; compositions may break the content grid but not the viewport',
    spacing: [4, 8, 12, 16, 24, 32, 48, 72, 104, 144],
    sectionRhythm: 'alternate compressed evidence, expansive narrative, and full-bleed media; never repeat the same composition consecutively',
    navTreatment: 'compact intent-led navigation with one unmistakable conversion action',
    heroTreatment: selected.layoutPersonality,
    ctaStyle: 'solid primary with a physical press state; secondary action uses text and directional line movement',
    imageTreatment: selected.photographyDirection,
    cardTreatment: 'use a card only for independently actionable content; vary scale and avoid icon-circle feature grids',
    iconTreatment: selected.iconDirection,
    svgStyle: {
      strokeWidth: context.productType === 'fitness' ? 1.75 : 1.5,
      cornerStyle: context.productType === 'fitness' ? 'square' : 'soft',
      lineCap: context.productType === 'fitness' ? 'square' : 'round',
      fillStrategy: 'none',
      opticalScale: 0.92,
    },
    dividerTreatment: 'fine technical rules derived from the signature motif',
    decorativeLanguage: selected.textureLanguage,
    motion: { personality: selected.motionPersonality, primitives: ['image mask reveal', 'line draw', 'purposeful stagger'], reducedMotion: 'remove transforms and reveal content immediately' },
  };
}

function storyboardFor(context: ProductDesignContext, selected: ArtDirection): PageStoryboard {
  const fitness = context.productType === 'fitness';
  const sections = fitness ? [
    ['arrival', 'Create physical impact and declare the training philosophy', 'directional athlete photograph with subject offset for cropped type', 'one sharp promise and one training action', 'immersive asymmetric hero', 'single image-mask reveal'],
    ['method', 'Explain how training is approached', 'annotated movement sequence and coaching notes', 'specific method, no generic benefits list', 'sticky story with changing media', 'line progress tied to scroll'],
    ['place', 'Make the facility tangible', 'full-bleed architectural training-floor image', 'short sensory caption', 'full-bleed media interlude', 'slow controlled crop'],
    ['programs', 'Help visitors identify the right training path', 'three unequal editorial program chapters', 'outcomes, cadence, and who each program serves', 'magazine columns, not equal cards', 'focused hover response'],
    ['authority', 'Establish coach credibility', 'one dominant portrait plus compact credential rail', 'named experience and coaching belief', 'asymmetric image/text split', 'portrait reveal'],
    ['results', 'Show believable evidence without vanity counters', 'specific member stories and measured progress notes', 'credible qualitative proof', 'quote feature with stat rail', 'number and rule reveal'],
    ['membership', 'Make the first visit easy to choose', 'clear membership path and visit details', 'price context only when supported', 'focused closing composition', 'no ambient motion'],
  ] : [
    ['arrival', 'State the distinctive promise', 'one subject-defining visual', 'short specific opening copy', 'immersive asymmetric hero', 'single orchestrated reveal'],
    ['evidence', 'Make the promise tangible', 'real product, process, place, or outcome evidence', 'specific proof rather than claims', 'editorial split', 'subtle image reveal'],
    ['story', 'Explain the point of view', 'subject-derived artifacts or media', 'concise narrative', 'sticky story', 'progressive line'],
    ['offer', `Lead toward ${context.conversionGoal}`, 'clear selection or action context', 'plain next-step copy', 'focused decision section', 'interaction feedback only'],
  ];
  return { sections: sections.map(([id, purpose, visual, copyDirection, composition, motion]) => ({ id: id!, purpose: purpose!, visual: visual!, copyDirection: copyDirection!, composition: composition!, motion: motion! })) };
}

export function createDesignEngineV3(context: ProductDesignContext): DesignEngineV3 {
  const brandStrategy = createBrandStrategy(context);
  const candidates = createArtDirectionCandidates(context);
  const selectionScores = scoreCandidates(context, candidates);
  const selected = selectDirection(candidates, selectionScores);
  return DesignEngineV3Schema.parse({
    version: 3, brandStrategy, candidates, selected, selectionScores,
    recipe: recipeFor(context, selected),
    storyboard: storyboardFor(context, selected),
  });
}

export function designEngineV3Prompt(engine: DesignEngineV3): string {
  return [
    'Reklu Design Engine V3 — decide visually before coding. This is a binding art-direction contract:',
    JSON.stringify({
      brandStrategy: engine.brandStrategy,
      artDirection: engine.selected,
      designRecipe: engine.recipe,
      pageStoryboard: engine.storyboard,
    }, null, 2),
    'Compiled token foundation (copy these values into the project stylesheet; extend them only when the recipe requires it):',
    '```css',
    designRecipeToCssVariables(engine.recipe),
    '```',
    'Compile this contract into tokens, composition, imagery, one coherent SVG icon family, responsive behavior, and restrained motion.',
    'Use CSS custom properties for every semantic palette, typography, spacing, radius, and motion value. Prefer the supplied OKLCH colors directly.',
    'Do not replace the storyboard with Hero/Features/Testimonials/Pricing/FAQ. Do not repeat the same section composition consecutively.',
    'Never use emoji as UI or feature icons. Use Lucide/Phosphor only when installed, or emit a coherent inline SVG family.',
    'Do not fabricate counters, ratings, clients, or outcomes. Use credible named details or omit unsupported proof.',
    'Images must follow the art direction and layout crop; provide stable designed placeholders when final assets are not available.',
    'Keep the first preview fast: no remote image or font request may block meaningful rendering.',
  ].join('\n');
}

/** Compile the recipe's deterministic decisions into runtime CSS tokens. */
export function designRecipeToCssVariables(recipe: DesignRecipe): string {
  const palette = Object.entries(recipe.palette)
    .map(([name, value]) => `  --color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`);
  const spacing = recipe.spacing.map((value, index) => `  --space-${index + 1}: ${value}px;`);
  return [
    ':root {',
    `  --font-display: "${recipe.typography.displayFont}", ui-sans-serif, system-ui, sans-serif;`,
    `  --font-body: "${recipe.typography.bodyFont}", ui-sans-serif, system-ui, sans-serif;`,
    `  --font-mono: "${recipe.typography.monoFont}", ui-monospace, monospace;`,
    `  --type-hero: ${recipe.typography.heroSize};`,
    `  --type-h1: ${recipe.typography.h1};`,
    `  --type-h2: ${recipe.typography.h2};`,
    ...palette,
    ...spacing,
    '  --duration-fast: 140ms;',
    '  --duration-normal: 280ms;',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root { --duration-fast: 0ms; --duration-normal: 0ms; }',
    '}',
  ].join('\n');
}
