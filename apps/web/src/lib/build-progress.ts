import type { BuildStep } from '@/app/(app)/build/actions';

export interface BuildProgressSnapshot {
  readonly status: string;
  readonly detail: string | null;
  readonly fileCount: number;
  readonly steps: readonly BuildStep[];
}

/**
 * Ask what the build is doing.
 *
 * A plain fetch, deliberately. The same question asked through a server action
 * queues behind whatever action is already running — which, while a build is
 * generating, is the build — so the answer arrived only once there was nothing
 * left to report.
 */
export async function fetchBuildProgress(
  buildId: string,
  signal?: AbortSignal,
): Promise<BuildProgressSnapshot | undefined> {
  try {
    const response = await fetch(`/api/build/${encodeURIComponent(buildId)}/progress`, {
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) return undefined;
    return (await response.json()) as BuildProgressSnapshot;
  } catch {
    /* A poll that fails is not worth reporting; the build reports itself. */
    return undefined;
  }
}
