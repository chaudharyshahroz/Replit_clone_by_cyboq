export type BuildPath = 'fast' | 'agentic';

export interface BuildPathInput {
  readonly target: string;
  readonly pages?: readonly unknown[];
  readonly dataModel?: readonly unknown[];
  readonly integrations?: readonly unknown[];
  readonly needsAuth?: boolean;
  readonly needsDatabase?: boolean;
}

export interface BuildPathDecision {
  readonly path: BuildPath;
  readonly reason: string;
  readonly budgetsMs: {
    readonly planning: number;
    readonly criticalGeneration: number;
    readonly previewBoot: number;
  };
  readonly deferUntilPreview: readonly ('research' | 'design_polish' | 'assets' | 'full_checks')[];
}

/** Keep simple visual builds out of the expensive autonomous path. */
export function chooseBuildPath(input: BuildPathInput): BuildPathDecision {
  const simpleWebsite = input.target === 'website' && !input.needsAuth && !input.needsDatabase;
  const simpleDashboard = input.target === 'dashboard'
    && (input.dataModel?.length ?? 0) <= 4
    && (input.integrations?.length ?? 0) === 0;
  const compactScope = (input.pages?.length ?? 0) <= 6;

  if ((simpleWebsite || simpleDashboard) && compactScope) {
    return {
      path: 'fast',
      reason: simpleWebsite
        ? 'A self-contained website can compile from structured design data without deep agent loops.'
        : 'This dashboard has a compact local scope and no external integration dependency.',
      budgetsMs: { planning: 5_000, criticalGeneration: 15_000, previewBoot: 10_000 },
      deferUntilPreview: ['research', 'design_polish', 'assets', 'full_checks'],
    };
  }

  return {
    path: 'agentic',
    reason: 'The build has application, data, authentication, integration, or multi-page complexity.',
    budgetsMs: { planning: 20_000, criticalGeneration: 90_000, previewBoot: 30_000 },
    deferUntilPreview: ['design_polish', 'full_checks'],
  };
}
