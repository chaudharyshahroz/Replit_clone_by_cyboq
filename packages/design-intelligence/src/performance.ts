export type BuildMilestone =
  | 'prompt_received'
  | 'product_understood'
  | 'design_ready'
  | 'generation_started'
  | 'first_file'
  | 'generation_completed'
  | 'design_polish_completed'
  | 'assets_completed'
  | 'checkpoint_completed'
  | 'preview_sync_started'
  | 'preview_updated'
  | 'validation_completed'
  | 'build_completed';

export interface BuildPerformanceMark {
  readonly milestone: BuildMilestone;
  readonly elapsedMs: number;
  readonly at: string;
  readonly detail?: string;
}

export interface BuildPerformanceTimeline {
  mark(milestone: BuildMilestone, detail?: string): Promise<BuildPerformanceMark>;
  elapsedMs(): number;
}

/**
 * Records actual monotonic durations while also carrying a wall-clock timestamp
 * for durable logs. The callback decides persistence and must never block the
 * build on analytics failure.
 */
export function createBuildPerformanceTimeline(
  report: (mark: BuildPerformanceMark) => void | Promise<void>,
  now: () => number = () => performance.now(),
  wallClock: () => Date = () => new Date(),
): BuildPerformanceTimeline {
  const started = now();
  return {
    elapsedMs: () => Math.max(0, Math.round(now() - started)),
    async mark(milestone, detail) {
      const value: BuildPerformanceMark = {
        milestone,
        elapsedMs: Math.max(0, Math.round(now() - started)),
        at: wallClock().toISOString(),
        ...(detail ? { detail } : {}),
      };
      await report(value);
      return value;
    },
  };
}
