import { DesignEvaluationSchema, type DesignEvaluation } from './schemas';

export const DEFAULT_DESIGN_THRESHOLD = 82;
export const MAX_DESIGN_REFINEMENT_PASSES = 2;

export function parseDesignEvaluation(value: unknown): DesignEvaluation {
  return DesignEvaluationSchema.parse(value);
}

export function shouldRefine(evaluation: DesignEvaluation, completedPasses: number, threshold = DEFAULT_DESIGN_THRESHOLD): boolean {
  return evaluation.overall < threshold && evaluation.issues.length > 0 && completedPasses < MAX_DESIGN_REFINEMENT_PASSES;
}

export function refinementPrompt(evaluation: DesignEvaluation): string {
  const issues = evaluation.issues.filter((issue) => issue.severity !== 'low');
  return [
    `Design score: ${evaluation.overall}/100. Apply a targeted refinement only.`,
    ...issues.map((issue) => `- ${issue.location}: ${issue.problem} Fix: ${issue.suggestedFix}${issue.affectedFiles.length ? ` Files: ${issue.affectedFiles.join(', ')}` : ''}`),
    'Preserve working behavior, routes, unrelated files, and the project Design DNA.',
  ].join('\n');
}
