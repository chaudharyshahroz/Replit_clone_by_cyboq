# Design Engine V4 baseline audit

2026-09-04. Scope: shared Build pipeline; Coffino is a regression case, not a template.

## Observed failures and code evidence

- `generate.ts` concatenates catalogue direction, Design DNA and V3 recipe. These independently choose fonts/colors. Restaurant DNA specifies Fraunces and terracotta; V3 specifies Instrument Serif and green. No single authoritative compiled artifact exists.
- `v3.ts` emits a 9rem/10vw hero with a 13ch heading measure. Large type in a split column explains the risk of six-line headlines; screenshots establish the failure, not the exact generated CSS.
- `context.ts` classifies “coffee shop” as commerce (coffee is absent from hospitality matching); fashion stores are also commerce because shop precedes fashion. Brand-specific intent is lost before art direction.
- `design-quality.ts` rejects four Card references regardless of their purpose. Normal product grids are treated as blocking defects. This encourages unnecessary asymmetry and narrow cards.
- V3 direction scores are constants derived from candidate index, not measured brand fit or screenshot quality. They must not be represented as a benchmark.
- Recipe CSS exists only inside a prompt. The generator can omit utilities or mismatch tokens. `repair-styles.ts` fixes Tailwind activation, not semantic consistency or actual browser geometry.
- Asset completion is separate from successful image decode/relevance. Supplied screenshots show missing hero/story/product assets. A generated URL is not evidence of a loaded image.
- `visuallyReviewPreview` was disconnected from the preview action. Its old single screenshot path covers a desktop screen after a fixed wait, not the full document or mobile. Its numeric score could pass despite critical findings.

## Existing execution path

`apps/web/.../build/actions.ts:runGeneration` loads brief and existing tree → heuristic product context, persisted DNA/V3 → model selection and composed prompt → streamed `generateFiles` → merge → agentic-only design pass and one source critic revision → genericity analytics → normalization/import closure → image fulfillment/checkpoint → preview synchronization.

Before this change, `startPreviewAction` repaired the tree → installed dependencies → started the dev server → returned after readiness checks. Deferred assets/review had no durable executor. The V4 changes enqueue a version-bound worker after readiness, including updates to an already-running preview. Existing checkpoints and working-runtime restoration are retained.

## Latency evidence limits

Fast builds already defer design/asset work and have real performance marks. Agentic builds can add sequential design, critic and import-closure calls before preview. E2B visual capture allocates a separate desktop sandbox. There is no measured P50/P95 baseline in this audit; do not claim the requested 10–30 second preview target is achieved. Warm runtime/dependency performance needs production measurements, not invented timing.

## Implementation order

1. Correct classification and unify the contract, with backwards-compatible stored projects.
2. Compile safe type/layout/color primitives and asset components into generated projects.
3. Remove false-positive product-grid rejection; make critical visual findings override scores.
4. Preserve explicit pending/needs-revision states when visual evidence is unavailable.
5. Validate category fixtures and compiler integration before live generation benchmarks.

Remaining V4 work must be tracked honestly in IMPLEMENTATION_STATUS.md. No comparison win is claimed from source tests.
