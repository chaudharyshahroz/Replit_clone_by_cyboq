# Reklu Design Intelligence

**Status:** foundation integrated; screenshot scoring and editing already exist; multi-viewport QA and section variations remain.

## Current prompt-to-preview flow

```text
User prompt
  → build brief (`generateBrief`, persisted on `build_projects`)
  → website market research when configured
  → product context + persistent Design DNA + information architecture
  → design catalogue direction
  → streamed whole-tree generation (`generateFiles`)
  → presentation-only design pass
  → source-level design audit and at most one correction
  → normalization, artwork, badge, visual-selection metadata
  → immutable checkpoint (`build_versions` + `build_files`)
  → sandbox sync/start and dependency install
  → browser screenshot
  → separate vision-model review
  → targeted corrective edit, second screenshot, rollback on regression
  → preview
```

The production entrypoint is `apps/web/src/app/(app)/build/actions.ts`. Generation and preview services are in `packages/build`; execution isolation is in `packages/sandbox`.

## Five largest design-quality problems found

1. **Design intent was transient.** Catalogue direction was recomputed from the brief for each pass and was not persisted as a complete project token contract. Later pages or edits could drift.
2. **Business understanding was too shallow.** The Build Brief describes engineering scope, but lacks conversion, trust, device, visual-density, and brand-personality fields. A restaurant and SaaS product could still enter similar IA.
3. **IA was implicit in prompts.** Site strategy could supply pages, but no deterministic, reusable information architecture existed before pattern selection.
4. **Critic output was too coarse.** Screenshot review returned one score and string findings rather than category scores, severity, location, suggested fixes, and affected files.
5. **Pattern intelligence is uncatalogued.** There are strong anti-template prompt rules, but no typed library of adaptable navigation, hero, proof, pricing, dashboard, form, and state patterns with suitability constraints.

## Implemented foundation

`@reklu/design-intelligence` now owns:

- `ProductDesignContextSchema`
- `DesignDNASchema`
- deterministic business classification and defaults
- business-specific information architecture
- persistent, tokenized Design DNA
- structured design-evaluation schema
- bounded refinement policy (`MAX_DESIGN_REFINEMENT_PASSES = 2`)

The Build action stores `productDesignContext`, `designDNA`, and `informationArchitecture` in the project's existing analysis envelope. Every subsequent generation passes the same DNA into the generator system context. This provides backwards-compatible persistence without inventing a second project record.

## Existing systems retained

- design catalogue and matching in `packages/build/src/design-intelligence.ts`
- deterministic source audit in `design-quality.ts`
- presentation-only design rewrite in `design-pass.ts`
- real-browser vision review in `visual-review.ts`
- stable preview element/source mapping in `source-map.ts`
- checkpoint and rollback support in `versions.ts`

## Next milestones

1. Replace the legacy visual-review shape with the structured category schema and store evaluation history.
2. Render 1440, 1024, 768, and 390 screenshots after first preview; never block first preview on them.
3. Add a typed component-pattern registry and selection scoring.
4. Add isolated section variation generation and checkpointed merge.
5. Add reusable user Design Systems and reference extraction.
6. Surface Design Quality unobtrusively in the Design workspace mode.

