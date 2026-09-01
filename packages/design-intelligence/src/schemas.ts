import { z } from 'zod';

export const ProductDesignContextSchema = z.object({
  productType: z.enum([
    'saas', 'restaurant', 'fintech', 'commerce', 'developer_tool', 'portfolio',
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
