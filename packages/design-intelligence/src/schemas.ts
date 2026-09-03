import { z } from 'zod';

export const ProductDesignContextSchema = z.object({
  productType: z.enum([
    'saas', 'restaurant', 'fintech', 'commerce', 'developer_tool', 'portfolio',
    'fitness', 'fashion', 'agency',
    'healthcare', 'local_service', 'content', 'dashboard', 'application', 'other',
  ]),
  industry: z.string().min(1),
  audience: z.array(z.string()).min(1).max(8),
  primaryGoal: z.string().min(1),
  primaryCTA: z.string().min(1),
  secondaryGoals: z.array(z.string()).max(8),
  requiredPages: z.array(z.object({ name: z.string(), purpose: z.string() })).max(24),
  brandPersonality: z.array(z.string()).min(1).max(6),
  visualTone: z.array(z.string()).min(1).max(6),
  informationDensity: z.enum(['low', 'balanced', 'high']),
  trustRequirements: z.array(z.string()).max(8),
  conversionGoal: z.string().min(1),
  devicePriority: z.enum(['mobile', 'desktop', 'balanced']),
  userReferences: z.array(z.string()).max(12),
  competitorReferences: z.array(z.string()).max(12),
  existingBrand: z.boolean(),
});

export type ProductDesignContext = z.infer<typeof ProductDesignContextSchema>;

export const BrandStrategySchema = z.object({
  industry: z.string().min(1),
  audience: z.array(z.string()).min(1),
  positioning: z.string().min(1),
  emotionalGoal: z.string().min(1),
  desiredPerception: z.string().min(1),
  primaryConversion: z.string().min(1),
  brandKeywords: z.array(z.string()).min(3),
  antiKeywords: z.array(z.string()).min(3),
  trustSignals: z.array(z.string()),
  differentiation: z.string().min(1),
});
export type BrandStrategy = z.infer<typeof BrandStrategySchema>;

export const ArtDirectionSchema = z.object({
  id: z.string().min(1),
  conceptName: z.string().min(1),
  conceptStatement: z.string().min(1),
  visualMood: z.array(z.string()).min(3),
  visualReferences: z.array(z.string()).min(2),
  typographyDirection: z.string().min(1),
  paletteDirection: z.string().min(1),
  photographyDirection: z.string().min(1),
  iconDirection: z.string().min(1),
  illustrationDirection: z.string().min(1),
  layoutPersonality: z.string().min(1),
  shapeLanguage: z.string().min(1),
  textureLanguage: z.string().min(1),
  motionPersonality: z.string().min(1),
  signatureElements: z.array(z.string()).min(1).max(3),
  avoid: z.array(z.string()).min(3),
});
export type ArtDirection = z.infer<typeof ArtDirectionSchema>;

const SemanticPaletteSchema = z.object({
  background: z.string(), backgroundElevated: z.string(), surface: z.string(),
  surfaceMuted: z.string(), foreground: z.string(), foregroundMuted: z.string(),
  primary: z.string(), primaryHover: z.string(), primaryActive: z.string(),
  secondary: z.string(), accent: z.string(), borderSubtle: z.string(),
  borderStrong: z.string(), success: z.string(), warning: z.string(), error: z.string(),
});

export const SVGStyleSchema = z.object({
  strokeWidth: z.number().positive(),
  cornerStyle: z.enum(['square', 'soft', 'round']),
  lineCap: z.enum(['butt', 'round', 'square']),
  fillStrategy: z.enum(['none', 'solid', 'duotone']),
  opticalScale: z.number().positive(),
});
export type SVGStyle = z.infer<typeof SVGStyleSchema>;

export const DesignRecipeSchema = z.object({
  version: z.literal(3),
  artDirectionId: z.string(),
  pageCanvas: z.string(),
  typography: z.object({
    displayFont: z.string(), bodyFont: z.string(), monoFont: z.string(),
    heroSize: z.string(), h1: z.string(), h2: z.string(), h3: z.string(),
    body: z.string(), small: z.string(), paragraphWidth: z.string(), headingWidth: z.string(),
  }),
  palette: SemanticPaletteSchema,
  colorBalance: z.object({ neutral: z.string(), primary: z.string(), accent: z.string() }),
  grids: z.string(), spacing: z.array(z.number().positive()), sectionRhythm: z.string(),
  navTreatment: z.string(), heroTreatment: z.string(), ctaStyle: z.string(),
  imageTreatment: z.string(), cardTreatment: z.string(), iconTreatment: z.string(),
  svgStyle: SVGStyleSchema,
  dividerTreatment: z.string(), decorativeLanguage: z.string(),
  motion: z.object({ personality: z.string(), primitives: z.array(z.string()), reducedMotion: z.string() }),
});
export type DesignRecipe = z.infer<typeof DesignRecipeSchema>;

export const PageStoryboardSchema = z.object({
  sections: z.array(z.object({
    id: z.string(), purpose: z.string(), visual: z.string(), copyDirection: z.string(),
    composition: z.string(), motion: z.string(),
  })).min(3),
});
export type PageStoryboard = z.infer<typeof PageStoryboardSchema>;

export const DesignEngineV3Schema = z.object({
  version: z.literal(3),
  brandStrategy: BrandStrategySchema,
  candidates: z.array(ArtDirectionSchema).length(3),
  selected: ArtDirectionSchema,
  selectionScores: z.record(z.object({ brandFit: z.number(), originality: z.number(), conversionClarity: z.number(), visualPotential: z.number(), contentFit: z.number() })),
  recipe: DesignRecipeSchema,
  storyboard: PageStoryboardSchema,
});
export type DesignEngineV3 = z.infer<typeof DesignEngineV3Schema>;

const ColorRoleSchema = z.object({
  background: z.string(), surface: z.string(), surfaceRaised: z.string(),
  text: z.string(), muted: z.string(), border: z.string(), primary: z.string(),
  onPrimary: z.string(), success: z.string(), warning: z.string(), danger: z.string(),
});

export const DesignDNASchema = z.object({
  version: z.literal(1),
  directionId: z.string(),
  personality: z.array(z.string()).min(1),
  visualDirection: z.string(),
  typography: z.object({
    display: z.string(), body: z.string(), mono: z.string(),
    displayWeight: z.number().int(), bodyWeight: z.number().int(), scale: z.array(z.number()),
  }),
  colors: ColorRoleSchema,
  spacing: z.array(z.number().positive()),
  radius: z.object({ sm: z.number(), md: z.number(), lg: z.number(), pill: z.number() }),
  shadows: z.object({ subtle: z.string(), elevated: z.string() }),
  borders: z.object({ width: z.number(), style: z.string() }),
  layoutGrid: z.object({ columns: z.number().int(), gutter: z.number(), margin: z.number() }),
  containerWidths: z.object({ content: z.number(), wide: z.number() }),
  iconography: z.string(), imageryStyle: z.string(), cardStyle: z.string(),
  buttonStyle: z.string(), inputStyle: z.string(), navigationStyle: z.string(),
  motion: z.object({ style: z.string(), durationMs: z.tuple([z.number(), z.number()]) }),
  density: z.enum(['low', 'balanced', 'high']),
  responsiveStrategy: z.string(),
  accessibilityRules: z.array(z.string()), doRules: z.array(z.string()), dontRules: z.array(z.string()),
});

export type DesignDNA = z.infer<typeof DesignDNASchema>;

export const DesignIssueSchema = z.object({
  severity: z.enum(['blocking', 'high', 'medium', 'low']),
  location: z.string(),
  problem: z.string(),
  suggestedFix: z.string(),
  affectedFiles: z.array(z.string()).default([]),
});

export const DesignEvaluationSchema = z.object({
  overall: z.number().min(0).max(100),
  hierarchy: z.number().min(0).max(100), spacing: z.number().min(0).max(100),
  typography: z.number().min(0).max(100), consistency: z.number().min(0).max(100),
  responsive: z.number().min(0).max(100), accessibility: z.number().min(0).max(100),
  originality: z.number().min(0).max(100), conversion: z.number().min(0).max(100),
  issues: z.array(DesignIssueSchema).max(20),
});

export type DesignEvaluation = z.infer<typeof DesignEvaluationSchema>;
