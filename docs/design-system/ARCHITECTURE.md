# Design Intelligence V5 Architecture

V5 is a pipeline, not a single design prompt.

`Product input → ProductSpec → BrandStrategy → 3 ArtDirections → selection → DesignDNA → storyboard/layout/assets → deterministic compiler → preview → visual critic → bounded fixer → quality gate`

The roles in `activeAgents` are logical responsibilities. They are combined into a small number of model calls when possible; role separation does not imply twelve paid calls.

## Authority boundaries

- Product Interpreter normalizes intent and required journeys.
- Brand and Art Directors decide positioning and the visual concept.
- Design System Guardian owns tokens and allowable primitives.
- Layout, Asset, and Motion Directors create deterministic implementation recipes.
- UI Builder implements the recipe without inventing a parallel aesthetic.
- Visual Critic judges rendered pixels at all required viewport widths.
- Design Fixer receives only actionable findings and is limited to one bounded pass.
- Accessibility/Responsive Auditor is represented in the gate; unverifiable checks remain pending.

## Persistence

The complete V5 object is stored in `build_projects.codebase_analysis.designEngineV5`. Generated projects also receive `.reklu/product.json`, `brand.json`, `art-direction.json`, `design-dna.json`, `design-recipe.json`, `assets.json`, `component-registry.json`, and `component-usage.json`.

## Provider integrity

Initial generation, visual review, and repair remain on the explicitly selected provider. If a compatible same-provider vision or repair model is unavailable, quality stays pending. Reklu must never consume DeepSeek, Kimi, or another vendor because of an undisclosed fallback.
