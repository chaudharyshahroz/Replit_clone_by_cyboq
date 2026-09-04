export const DESIGN_VIEWPORTS = [1440, 1024, 768, 430, 390] as const;
export interface RenderEvidence {
  width: number;
  fullPage: boolean;
  score: number;
  criticalFindings: readonly string[];
}
export interface AssetEvidence {
  id: string;
  critical: boolean;
  status: 'planned' | 'loading' | 'loaded' | 'failed';
  naturalWidth: number;
  naturalHeight: number;
  relevance: 'verified' | 'unverified' | 'rejected';
}

/** Missing evidence is pending, never an implicit pass. Scores cannot average away hard failures. */
export function evaluatePremiumGate(input: {
  renders: readonly RenderEvidence[];
  assets: readonly AssetEvidence[];
  assetsAudited: boolean;
  interactionsVerified: boolean;
}) {
  const failures = input.renders.flatMap((r) => [...r.criticalFindings]);
  const pending: string[] = [];
  for (const width of DESIGN_VIEWPORTS) {
    const render = input.renders.find((r) => r.width === width && r.fullPage);
    if (!render) pending.push(`Full-page evidence missing at ${width}px`);
    else if (!Number.isFinite(render.score) || render.score < 82)
      failures.push(`Visual threshold not met at ${width}px`);
  }
  if (!input.assetsAudited) pending.push('Asset inventory has not been audited');
  for (const asset of input.assets.filter((a) => a.critical)) {
    if (asset.status === 'failed' || asset.relevance === 'rejected')
      failures.push(`Critical asset failed: ${asset.id}`);
    else if (
      asset.status !== 'loaded' ||
      !(asset.naturalWidth > 0 && asset.naturalHeight > 0) ||
      asset.relevance !== 'verified'
    )
      pending.push(`Critical asset unverified: ${asset.id}`);
  }
  if (!input.interactionsVerified) pending.push('Primary user flow has not been verified');
  return {
    status: failures.length
      ? ('needs_revision' as const)
      : pending.length
        ? ('pending' as const)
        : ('approved' as const),
    failures,
    pending,
  };
}
