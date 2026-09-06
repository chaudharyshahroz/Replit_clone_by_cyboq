import { z } from 'zod';
import type { ProductDesignContext } from './schemas';
import { createDesignEngineV4, DesignEngineV4Schema, type DesignEngineV4 } from './v4';

export const DESIGN_ENGINE_V5_REVISION = 1;

export const ProductSpecSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1),
  productType: z.string().min(1),
  audience: z.array(z.string()).min(1),
  primaryGoal: z.string().min(1),
  secondaryGoals: z.array(z.string()),
  requiredPages: z.array(z.string()).min(1),
  commerce: z.boolean(),
  visualPriority: z.enum(['low', 'medium', 'high']),
  primaryAction: z.string().min(1),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

export const BrandStrategyV5Schema = z.object({
  positioning: z.string().min(1),
  audience: z.array(z.string()).min(1),
  emotionalGoal: z.string().min(1),
  desiredPerception: z.string().min(1),
  brandKeywords: z.array(z.string()).min(3),
  antiKeywords: z.array(z.string()).min(3),
  brandPersonality: z.array(z.string()).min(1),
  voice: z.string().min(1),
  trustSignals: z.array(z.string()),
  differentiation: z.array(z.string()).min(1),
  visualOpportunity: z.string().min(1),
});
export type BrandStrategyV5 = z.infer<typeof BrandStrategyV5Schema>;

export const ArtDirectionV5Schema = z.object({
  id: z.string().min(1),
  conceptName: z.string().min(1),
  conceptStatement: z.string().min(1),
  visualMood: z.array(z.string()).min(3),
  typographyDirection: z.string().min(1),
  paletteDirection: z.string().min(1),
  photographyDirection: z.string().min(1),
  illustrationDirection: z.string().min(1),
  iconDirection: z.string().min(1),
  layoutPersonality: z.string().min(1),
  shapeLanguage: z.string().min(1),
  textureLanguage: z.string().min(1),
  motionPersonality: z.string().min(1),
  signatureMotifs: z.array(z.string()).min(1).max(3),
  avoid: z.array(z.string()).min(3),
  score: z.object({
    brandFit: z.number().min(0).max(100),
    visualPotential: z.number().min(0).max(100),
    originality: z.number().min(0).max(100),
    conversionSuitability: z.number().min(0).max(100),
    contentSuitability: z.number().min(0).max(100),
  }),
});
export type ArtDirectionV5 = z.infer<typeof ArtDirectionV5Schema>;

export const ReferenceAnalysisSchema = z.object({
  sources: z.array(z.string()),
  layoutPrinciples: z.array(z.string()),
  typeCharacter: z.string(),
  colorRelationships: z.string(),
  density: z.string(),
  spacing: z.string(),
  imageTreatment: z.string(),
  navigation: z.string(),
  shapeLanguage: z.string(),
  icons: z.string(),
  sectionRhythm: z.string(),
  interactionPatterns: z.array(z.string()),
  hierarchy: z.string(),
  policy: z.literal('derive-principles-never-clone'),
});
export type ReferenceAnalysis = z.infer<typeof ReferenceAnalysisSchema>;

export const PageStoryboardV5Schema = z.array(
  z.object({
    id: z.string(),
    sequence: z.number().int().positive(),
    purpose: z.string(),
    composition: z.string(),
    componentId: z.string(),
    density: z.enum(['quiet', 'balanced', 'dense', 'immersive']),
    backgroundRole: z.enum(['canvas', 'surface', 'primary', 'inverse']),
    typographyScale: z.enum(['display', 'section', 'body']),
    media: z.enum(['critical', 'optional', 'none']),
    motion: z.string(),
  }),
).min(3);
export type PageStoryboardV5 = z.infer<typeof PageStoryboardV5Schema>;

export const LayoutRecipeSchema = z.object({
  usabilityShare: z.literal(70),
  brandShare: z.literal(20),
  surpriseShare: z.literal(10),
  container: z.number().positive(),
  desktopHeroColumns: z.tuple([z.number().positive(), z.number().positive()]),
  mobileBreakpoint: z.number().positive(),
  headingFit: z.object({ desktopHeroLines: z.tuple([z.number(), z.number()]), sectionLines: z.tuple([z.number(), z.number()]), mobileHeroLines: z.tuple([z.number(), z.number()]) }),
  rhythm: z.array(z.enum(['immersive', 'quiet', 'visual', 'story', 'interactive', 'conclusion'])).min(3),
  prohibited: z.array(z.string()).min(3),
});
export type LayoutRecipe = z.infer<typeof LayoutRecipeSchema>;

export const AssetPlanSchema = z.array(
  z.object({
    id: z.string(),
    sectionId: z.string(),
    type: z.enum(['photo', 'illustration', 'svg', 'icon', 'diagram', 'none']),
    ratio: z.string(),
    direction: z.string(),
    composition: z.string(),
    subjectPosition: z.enum(['left', 'center', 'right', 'full']),
    negativeSpace: z.enum(['left', 'right', 'top', 'none']),
    priority: z.enum(['critical', 'optional']),
    fallback: z.string(),
  }),
);
export type AssetPlan = z.infer<typeof AssetPlanSchema>;

export const DesignSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  industries: z.array(z.string()),
  capabilities: z.array(z.string()),
  incompatibleWith: z.array(z.string()),
  priority: z.number(),
  rules: z.array(z.string()),
});
export type DesignSkill = z.infer<typeof DesignSkillSchema>;

export const ComponentDefinitionSchema = z.object({
  id: z.string(),
  family: z.enum(['hero', 'story', 'product', 'proof', 'location', 'cta', 'footer']),
  industries: z.array(z.string()),
  artDirections: z.array(z.string()),
  media: z.enum(['required', 'optional', 'none']),
  density: z.enum(['low', 'balanced', 'high']),
  themes: z.array(z.enum(['light', 'dark'])),
  responsiveStrategy: z.string(),
  motion: z.array(z.string()),
  variants: z.array(z.string()),
});
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;

export const DesignEngineV5Schema = z.object({
  version: z.literal(5),
  revision: z.number().int().positive(),
  productSpec: ProductSpecSchema,
  brandStrategy: BrandStrategyV5Schema,
  artDirectionCandidates: z.array(ArtDirectionV5Schema).length(3),
  artDirection: ArtDirectionV5Schema,
  referenceAnalysis: ReferenceAnalysisSchema,
  designDNA: z.record(z.unknown()),
  storyboard: PageStoryboardV5Schema,
  layoutRecipe: LayoutRecipeSchema,
  assetPlan: AssetPlanSchema,
  activeSkills: z.array(DesignSkillSchema).min(3),
  componentSelections: z.record(z.string()),
  activeAgents: z.array(z.object({ name: z.string(), mode: z.enum(['deterministic', 'structured-model', 'browser']), responsibility: z.string() })),
  compiler: z.object({ version: z.literal(4), engine: DesignEngineV4Schema }),
});
export type DesignEngineV5 = z.infer<typeof DesignEngineV5Schema>;

const coreRules = {
  premium: ['Use a named composition, not a template default.', 'Make one memorable signature motif repeat with restraint.'],
  brand: ['Derive every visual decision from product and audience.', 'Treat anti-keywords as hard exclusions.'],
  art: ['Choose composition before styling.', 'Use contrast in scale, density, and section rhythm.'],
  editorial: ['Balance expressive type with readable measure.', 'Use alignment and crops to create narrative rhythm.'],
  commerce: ['Keep product comparison familiar.', 'Make price, availability, and purchase action unambiguous.'],
  motion: ['Animate transform and opacity only.', 'Disable non-essential motion for reduced-motion users.'],
  responsive: ['Design mobile composition deliberately.', 'No horizontal overflow or accidental word stacks.'],
  accessibility: ['Normal text contrast is at least 4.5:1.', 'Controls are labelled, keyboard reachable, and at least 44px.'],
} as const;

const skill = (id: string, name: string, industries: string[], capabilities: string[], priority: number, rules: readonly string[]): DesignSkill => ({
  id, name, industries, capabilities, incompatibleWith: [], priority, rules: [...rules],
});

export const REKLU_DESIGN_SKILLS: readonly DesignSkill[] = [
  skill('premium-web', 'Reklu Premium Web Designer', ['all'], ['composition', 'hierarchy'], 100, coreRules.premium),
  skill('brand-design', 'Reklu Brand Designer', ['all'], ['brand', 'voice'], 98, coreRules.brand),
  skill('art-direction', 'Reklu Art Director', ['all'], ['art-direction', 'originality'], 96, coreRules.art),
  skill('editorial-design', 'Reklu Editorial Designer', ['hospitality', 'fashion', 'portfolio', 'content'], ['typography', 'layout', 'storytelling'], 80, coreRules.editorial),
  skill('saas-design', 'Reklu SaaS Designer', ['saas', 'ai'], ['product-proof', 'conversion'], 80, coreRules.premium),
  skill('ecommerce-design', 'Reklu E-commerce Designer', ['commerce', 'fashion', 'hospitality'], ['merchandising', 'conversion'], 84, coreRules.commerce),
  skill('luxury-design', 'Reklu Luxury Designer', ['fashion', 'restaurant', 'hospitality'], ['restraint', 'typography'], 76, coreRules.editorial),
  skill('developer-product', 'Reklu Developer Product Designer', ['developer_tool', 'ai'], ['technical-proof', 'documentation'], 86, coreRules.art),
  skill('ai-startup', 'Reklu AI Startup Designer', ['ai', 'saas'], ['product-demo', 'positioning'], 75, coreRules.brand),
  skill('hospitality-design', 'Reklu Hospitality Designer', ['restaurant', 'hospitality'], ['appetite', 'place', 'booking'], 90, coreRules.editorial),
  skill('fitness-design', 'Reklu Fitness Designer', ['fitness'], ['energy', 'programs'], 90, coreRules.art),
  skill('finance-design', 'Reklu Finance Designer', ['fintech', 'finance'], ['trust', 'data-density'], 90, coreRules.brand),
  skill('portfolio-design', 'Reklu Portfolio Designer', ['portfolio', 'agency'], ['case-studies', 'authorship'], 84, coreRules.editorial),
  skill('mobile-ux', 'Reklu Mobile UX Designer', ['application'], ['mobile', 'navigation'], 88, coreRules.responsive),
  skill('motion-design', 'Reklu Motion Designer', ['all'], ['motion'], 60, coreRules.motion),
  skill('svg-illustration', 'Reklu SVG Illustrator', ['developer_tool', 'saas', 'finance'], ['svg', 'diagrams'], 58, ['SVG inherits DesignDNA color and stroke.', 'Decorative SVG is aria-hidden.']),
  skill('design-system-guardian', 'Reklu Design System Guardian', ['all'], ['tokens', 'consistency'], 99, ['Components consume semantic tokens.', 'New visual primitives require a DesignDNA update.']),
  skill('responsive-design', 'Reklu Responsive Designer', ['all'], ['responsive'], 94, coreRules.responsive),
  skill('accessibility', 'Reklu Accessibility Expert', ['all'], ['accessibility'], 94, coreRules.accessibility),
  skill('conversion', 'Reklu Conversion Designer', ['commerce', 'saas', 'restaurant'], ['conversion'], 72, ['One primary action per decision point.', 'Trust appears before commitment.']),
  skill('visual-critic', 'Reklu Visual Critic', ['all'], ['visual-review'], 92, ['Judge rendered evidence, not JSX.', 'A visible defect overrides an average score.']),
  skill('reference-analysis', 'Reklu Reference Analyst', ['all'], ['reference-analysis'], 70, ['Extract principles, never source code.', 'Separate brand signals from reusable layout principles.']),
];

export const PREMIUM_COMPONENTS: readonly ComponentDefinition[] = [
  { id: 'hero-editorial-image-v2', family: 'hero', industries: ['hospitality', 'fashion', 'portfolio'], artDirections: ['editorial'], media: 'required', density: 'low', themes: ['light', 'dark'], responsiveStrategy: 'Two-column editorial split becomes image-after-copy with intact heading words.', motion: ['image-reveal'], variants: ['offset', 'captioned'] },
  { id: 'hero-cinematic-frame-v1', family: 'hero', industries: ['restaurant', 'fitness', 'fashion', 'local_service'], artDirections: ['cinematic', 'editorial'], media: 'required', density: 'low', themes: ['light', 'dark'], responsiveStrategy: 'Framed media follows the promise on mobile; actions never overlay the focal subject.', motion: ['mask-reveal'], variants: ['wide-frame', 'portrait-frame'] },
  { id: 'hero-typographic-proof-v1', family: 'hero', industries: ['all'], artDirections: ['editorial', 'technical'], media: 'optional', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Large type reduces fluidly while evidence remains a readable horizontal or stacked rail.', motion: ['type-reveal'], variants: ['proof-rail', 'index'] },
  { id: 'hero-product-proof-v1', family: 'hero', industries: ['saas', 'developer_tool', 'finance'], artDirections: ['technical'], media: 'optional', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Proof panel stacks after concise product promise.', motion: ['fade', 'line-draw'], variants: ['demo', 'terminal'] },
  { id: 'story-editorial-split-v2', family: 'story', industries: ['all'], artDirections: ['editorial', 'sculpted'], media: 'optional', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Copy and media alternate; copy measure stays below 68ch.', motion: ['fade'], variants: ['media-left', 'media-right'] },
  { id: 'story-chapter-index-v1', family: 'story', industries: ['all'], artDirections: ['editorial', 'technical'], media: 'optional', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Chapter numbers become a quiet vertical index without shrinking body copy.', motion: ['line-draw'], variants: ['numbered', 'captioned'] },
  { id: 'product-grid-editorial-v2', family: 'product', industries: ['commerce', 'hospitality', 'fashion'], artDirections: ['editorial', 'soft'], media: 'required', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Four-to-two-to-one columns with stable image ratios and prices.', motion: ['hover'], variants: ['catalogue', 'featured'] },
  { id: 'proof-sequence-v1', family: 'proof', industries: ['all'], artDirections: ['technical', 'editorial'], media: 'none', density: 'high', themes: ['light', 'dark'], responsiveStrategy: 'Horizontal evidence becomes numbered vertical sequence.', motion: ['stagger'], variants: ['numbered', 'ledger'] },
  { id: 'proof-quote-ledger-v1', family: 'proof', industries: ['all'], artDirections: ['editorial'], media: 'none', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Quotes and facts alternate in a single-column ledger on narrow screens.', motion: ['fade'], variants: ['quotes', 'facts'] },
  { id: 'location-story-v2', family: 'location', industries: ['hospitality', 'local_service', 'restaurant'], artDirections: ['editorial'], media: 'required', density: 'balanced', themes: ['light', 'dark'], responsiveStrategy: 'Address and hours precede media on narrow screens.', motion: ['fade'], variants: ['single', 'multi'] },
  { id: 'cta-contrast-band-v1', family: 'cta', industries: ['all'], artDirections: ['all'], media: 'none', density: 'low', themes: ['light', 'dark'], responsiveStrategy: 'Copy and one action stack without viewport-height padding.', motion: ['fade'], variants: ['primary', 'inverse'] },
  { id: 'footer-editorial-v2', family: 'footer', industries: ['all'], artDirections: ['editorial', 'technical', 'soft', 'sculpted'], media: 'none', density: 'balanced', themes: ['dark'], responsiveStrategy: 'Columns collapse into labelled groups; legal row remains last.', motion: [], variants: ['commerce', 'service', 'product'] },
];

function hasCommerce(context: ProductDesignContext): boolean {
  return context.productType === 'commerce' || [
    context.primaryGoal,
    context.primaryCTA,
    ...context.secondaryGoals,
    ...context.requiredPages.flatMap((page) => [page.name, page.purpose]),
  ].some((value) => /shop|store|cart|product|checkout|buy|order|e-?commerce/i.test(value));
}

export function routeDesignSkills(context: ProductDesignContext): readonly DesignSkill[] {
  const industry = context.industry.toLowerCase();
  const ids = new Set(['premium-web', 'brand-design', 'art-direction', 'design-system-guardian', 'responsive-design', 'accessibility', 'visual-critic']);
  if (/coffee|cafe|restaurant|hotel|hospitality|food/.test(industry) || context.productType === 'restaurant') ids.add('hospitality-design');
  if (['restaurant', 'fashion', 'portfolio', 'agency', 'content'].includes(context.productType)) ids.add('editorial-design');
  if (hasCommerce(context)) { ids.add('ecommerce-design'); ids.add('conversion'); }
  if (context.productType === 'developer_tool') { ids.add('developer-product'); ids.add('svg-illustration'); }
  if (context.productType === 'saas') { ids.add('saas-design'); ids.add('conversion'); }
  if (context.productType === 'fintech') ids.add('finance-design');
  if (context.productType === 'fitness') ids.add('fitness-design');
  if (context.productType === 'fashion') ids.add('luxury-design');
  if (context.productType === 'portfolio' || context.productType === 'agency') ids.add('portfolio-design');
  if (context.userReferences.length) ids.add('reference-analysis');
  ids.add('motion-design');
  return REKLU_DESIGN_SKILLS.filter((entry) => ids.has(entry.id)).sort((a, b) => b.priority - a.priority);
}

function productName(context: ProductDesignContext): string {
  return context.identitySeed?.replace(/^build[-:_ ]*/i, '').trim() || context.industry;
}

function artDirections(context: ProductDesignContext, v4: DesignEngineV4): [ArtDirectionV5, ArtDirectionV5, ArtDirectionV5] {
  const baseAvoid = ['generic card wall', 'gradient text', 'unrelated stock imagery', ...context.brandPersonality.map((value) => `generic ${value}`)].slice(0, 6);
  const make = (id: string, name: string, layout: string, type: string, photo: string, motif: string, scores: [number, number, number, number, number]): ArtDirectionV5 => ({
    id, conceptName: name, conceptStatement: `${name} turns ${context.industry} into a specific visual narrative built around ${motif}.`,
    visualMood: [...context.visualTone.slice(0, 3), name.toLowerCase()].slice(0, 4),
    typographyDirection: type, paletteDirection: `${v4.dna.colors.background}, ${v4.dna.colors.primary}, and one restrained ${v4.dna.colors.warning} accent`,
    photographyDirection: photo, illustrationDirection: 'Use token-bound line work only where photography cannot explain the idea.',
    iconDirection: `${v4.dna.iconography}; consistent 20–24px optical size`, layoutPersonality: layout,
    shapeLanguage: `${v4.selection.componentStyle}; one radius family with purposeful exceptions`, textureLanguage: 'Tactile detail used as punctuation, never a full-page filter',
    motionPersonality: v4.dna.motion.style, signatureMotifs: [motif], avoid: baseAvoid,
    score: { brandFit: scores[0], visualPotential: scores[1], originality: scores[2], conversionSuitability: scores[3], contentSuitability: scores[4] },
  });
  const photographic = ['restaurant', 'fashion', 'fitness', 'commerce', 'portfolio', 'agency', 'local_service'].includes(context.productType);
  const subject = photographic ? 'documentary, subject-specific photography with planned negative space' : 'real product UI and technical evidence, never abstract stock art';
  return [
    make(v4.selection.profile, v4.selection.profile.replace(/-/g, ' '), v4.storyboard[0]?.composition ?? 'editorial split', `${v4.dna.typography.display} with ${v4.dna.typography.body}`, subject, v4.selection.signature, [94, 91, 88, 91, 93]),
    make(`${v4.selection.profile}-studio`, 'Material Studio', 'modular image-led composition with tight utility details', `confident ${v4.dna.typography.body} with restrained display accents`, 'controlled studio crops with visible material and process', 'A recurring material index and numbered captions', [82, 87, 91, 84, 82]),
    make(`${v4.selection.profile}-quiet`, 'Quiet Authority', 'wide editorial fields with precise evidence rails', `measured ${v4.dna.typography.display} with compact body text`, 'quiet natural light, close human detail, no lifestyle clichés', 'A fine rule and oversized chapter numeral', [86, 84, 86, 80, 88]),
  ];
}

function componentHash(value: string): number {
  let hash = 0;
  for (const character of value) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return hash >>> 0;
}

function selectComponent(family: ComponentDefinition['family'], context: ProductDesignContext, seed: string): ComponentDefinition {
  const industry = context.productType;
  const candidates = PREMIUM_COMPONENTS.filter((item) => item.family === family && (item.industries.includes(industry) || item.industries.includes(context.industry) || item.industries.includes('all')));
  const pool = candidates.length ? candidates : PREMIUM_COMPONENTS.filter((item) => item.family === family);
  return pool[componentHash(`${seed}:${family}`) % pool.length]!;
}

export function createDesignEngineV5(context: ProductDesignContext, projectSeed?: string): DesignEngineV5 {
  const stableSeed = projectSeed ?? context.identitySeed ?? `${context.industry}:${context.primaryGoal}`;
  const compiler = createDesignEngineV4(context, projectSeed);
  const candidates = artDirections(context, compiler);
  const selected = [...candidates].sort((a, b) => Object.values(b.score).reduce((x, y) => x + y, 0) - Object.values(a.score).reduce((x, y) => x + y, 0))[0]!;
  const commerce = hasCommerce(context);
  const productSpec: ProductSpec = {
    name: productName(context), industry: context.industry, productType: context.productType,
    audience: context.audience, primaryGoal: context.primaryGoal, secondaryGoals: context.secondaryGoals,
    requiredPages: context.requiredPages.map((page) => page.name), commerce,
    visualPriority: context.productType === 'dashboard' || context.productType === 'application' ? 'medium' : 'high',
    primaryAction: context.primaryCTA,
  };
  const brandStrategy: BrandStrategyV5 = {
    positioning: `${productSpec.name} is a ${context.industry} experience designed for ${context.audience.join(' and ')}.`,
    audience: context.audience, emotionalGoal: context.visualTone.join(', '), desiredPerception: context.brandPersonality.join(', '),
    brandKeywords: [...new Set([...context.brandPersonality, ...context.visualTone, context.industry])].slice(0, 8),
    antiKeywords: ['generic AI template', 'SaaS gradient', 'interchangeable stock photography', 'emoji interface', 'default component library'],
    brandPersonality: context.brandPersonality, voice: 'Specific, concise, credible, and human.', trustSignals: context.trustRequirements,
    differentiation: [`A ${selected.conceptName} point of view`, ...context.trustRequirements.slice(0, 2)],
    visualOpportunity: selected.conceptStatement,
  };
  const rhythm = ['immersive', 'quiet', 'visual', 'story', 'interactive', 'conclusion'] as const;
  const storyboard: PageStoryboardV5 = compiler.storyboard.map((section, index) => {
    const family: ComponentDefinition['family'] = section.id === 'arrival' ? 'hero' : section.id === 'evidence' ? (commerce ? 'product' : 'proof') : section.id === 'action' ? 'cta' : 'story';
    return { id: section.id, sequence: index + 1, purpose: section.purpose || (index ? 'Support the decision' : context.primaryGoal), composition: section.composition,
      componentId: selectComponent(family, context, `${stableSeed}:${section.id}`).id, density: index === 0 ? 'immersive' : index === 1 ? 'balanced' : index === 2 ? 'quiet' : 'balanced',
      backgroundRole: index === compiler.storyboard.length - 1 ? 'inverse' : index % 2 ? 'surface' : 'canvas', typographyScale: index === 0 ? 'display' : 'section', media: section.media,
      motion: index === 0 ? 'soft image or product-proof reveal' : 'subtle opacity/transform entry only when useful' };
  });
  const assetPlan: AssetPlan = compiler.assets.map((asset, index) => ({
    id: asset.id, sectionId: asset.sectionId, type: 'photo', ratio: asset.aspectRatio,
    direction: `${selected.photographyDirection}; harmonize with ${selected.paletteDirection}`,
    composition: `${asset.subject}; crop for ${storyboard[index]?.composition ?? 'the selected composition'}`,
    subjectPosition: index === 0 ? 'right' : 'center', negativeSpace: index === 0 ? 'left' : 'none', priority: asset.priority,
    fallback: `Branded ${compiler.selection.componentStyle} placeholder using semantic surface, motif, and concise asset label`,
  }));
  const componentSelections = Object.fromEntries(storyboard.map((section) => [section.id, section.componentId]));
  const activeSkills = routeDesignSkills(context);
  const activeAgents = [
    ['Product Interpreter', 'deterministic', 'Normalize product scope without making visual decisions.'],
    ['Brand Director', 'structured-model', 'Define positioning, voice, brand signals, and exclusions.'],
    ['Art Director', 'structured-model', 'Compare three directions and select a coherent visual concept.'],
    ...(context.userReferences.length ? [['Reference Analyst', 'structured-model', 'Extract reusable principles from user references without cloning.']] : []),
    ['Design System Guardian', 'deterministic', 'Own DesignDNA and reject unauthorized visual primitives.'],
    ['Layout Director', 'deterministic', 'Compile narrative, rhythm, heading-fit, and component choices.'],
    ['Asset Director', 'deterministic', 'Plan layout-aware media and critical fallbacks.'],
    ['Motion Director', 'deterministic', 'Select restrained, accessible motion.'],
    ['UI Builder', 'structured-model', 'Implement behavior and content from the design contract.'],
    ['Visual Critic', 'browser', 'Judge real rendered evidence at required viewports.'],
    ['Design Fixer', 'structured-model', 'Patch only files named by actionable findings.'],
    ['Accessibility / Responsive Auditor', 'browser', 'Verify mobile, keyboard, contrast, and overflow.'],
  ].map(([name, mode, responsibility]) => ({ name: name!, mode: mode as 'deterministic' | 'structured-model' | 'browser', responsibility: responsibility! }));
  return DesignEngineV5Schema.parse({
    version: 5, revision: DESIGN_ENGINE_V5_REVISION, productSpec, brandStrategy,
    artDirectionCandidates: candidates, artDirection: selected,
    referenceAnalysis: { sources: context.userReferences, layoutPrinciples: [], typeCharacter: selected.typographyDirection, colorRelationships: selected.paletteDirection,
      density: context.informationDensity, spacing: 'Use one scale; alternate immersive and quiet sections.', imageTreatment: selected.photographyDirection,
      navigation: compiler.dna.navigationStyle, shapeLanguage: selected.shapeLanguage, icons: selected.iconDirection,
      sectionRhythm: rhythm.join(' → '), interactionPatterns: ['familiar navigation', 'one dominant action per decision point'], hierarchy: 'Promise, proof, detail, action.', policy: 'derive-principles-never-clone' },
    designDNA: compiler.dna, storyboard,
    layoutRecipe: { usabilityShare: 70, brandShare: 20, surpriseShare: 10, container: compiler.layout.container, desktopHeroColumns: [0.9, 1.1], mobileBreakpoint: 960,
      headingFit: { desktopHeroLines: [1, compiler.layout.heroMaxLines], sectionLines: [1, compiler.layout.sectionMaxLines], mobileHeroLines: [2, compiler.layout.mobileMaxLines] },
      rhythm, prohibited: ['one-word-per-line headings', 'repeated equal card grids', 'viewport-height whitespace', 'unplanned asymmetry'] },
    assetPlan, activeSkills, componentSelections, activeAgents,
    compiler: { version: 4, engine: compiler },
  }) as DesignEngineV5;
}

export function designEngineV5Prompt(engine: DesignEngineV5): string {
  return [
    'REKLU DESIGN INTELLIGENCE V5 — authoritative structured design-team contract.',
    'The UI Builder implements this contract. It must not independently choose a new brand, palette, type system, radius system, section order, or component family.',
    JSON.stringify({ productSpec: engine.productSpec, brandStrategy: engine.brandStrategy, artDirection: engine.artDirection, storyboard: engine.storyboard, layoutRecipe: engine.layoutRecipe, assetPlan: engine.assetPlan, activeSkills: engine.activeSkills.map(({ id, rules }) => ({ id, rules })), componentSelections: engine.componentSelections }),
    'Heading-fit is a correctness rule: whole words only, desktop hero 1–4 lines, section headings 1–3, mobile hero 2–5. If copy does not fit, shorten it or change scale/measure.',
    'Use the named component IDs as composition recipes, not literal imports. Use compiler-owned rk-* primitives for base UI and preserve the 70/20/10 balance: familiar usability, brand expression, signature surprise.',
    'Every planned critical asset must use BrandImage with its planned ratio, subject position, negative space, and fallback. Never expose browser broken-image UI.',
    'Repeat the selected signature motif in two or three places. Vary density, alignment, media, and background across adjacent sections. Do not repeat card-grid rhythm.',
    'Use only the active skills above. Inactive skills must not add unrelated patterns.',
  ].join('\n');
}
