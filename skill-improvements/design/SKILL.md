---
name: design
description: Route multi-discipline visual design work across brand identity, design systems, logos, corporate identity, presentations, banners, social graphics, and icons. Use when a request spans design disciplines or needs the correct specialized workflow; prefer a narrower design skill for a single well-defined deliverable.
license: MIT
metadata:
  author: claudekit
  version: "2.2.0"
---

# Design Router

Use this skill to choose and coordinate the smallest design workflow that covers the request. Preserve the user's requested medium, tool, format, brand constraints, and existing assets.

## Route the request

| Need | Use |
|---|---|
| Brand strategy, voice, identity rules | `brand` |
| Tokens, component specifications, systematic styling | `design-system` |
| Existing React/Tailwind/shadcn interface implementation | `ui-styling` |
| Distinctive visual direction for a new or reshaped frontend | `frontend-design` |
| Logo concepts or generation | [Logo guide](references/logo-design.md) |
| Corporate identity deliverables and mockups | [CIP guide](references/cip-design.md) |
| Presentation or pitch deck | Use the available presentation skill; use [slide strategy](references/slides-create.md) only for the legacy HTML workflow |
| Banner, cover, header, or ad creative | `banner-design` when available; otherwise read [banner guide](references/banner-sizes-and-styles.md) |
| Social media graphics | [Social graphics guide](references/social-photos-design.md) |
| SVG icon or icon family | [Icon guide](references/icon-design.md) |

Do not load every reference. Read only the guide for the selected deliverable. When one specialist fully covers the request, follow that skill directly rather than layering this router on top.

## Shared workflow

1. Identify the deliverable, audience, placement, dimensions or output format, required content, and any brand assets.
2. Inspect existing assets and code before inventing replacements. Ask only for missing information that would materially change the result.
3. Choose one coherent art direction grounded in the subject. For exploratory work, create a small set of meaningfully different directions rather than cosmetic variants.
4. Produce the artifact with the most appropriate available tool. Do not assume Gemini, browser automation, or a named third-party skill exists; use them only when callable and authorized.
5. Verify the actual output at its intended size. Check hierarchy, legibility, contrast, cropping, alignment, responsiveness where relevant, and export dimensions.
6. Iterate on observed issues and hand off the final artifact with editable sources when available.

## Quality bar

- Use real or clearly marked placeholder content; avoid generic marketing filler.
- Make typography, palette, spacing, imagery, and motion support the same concept.
- Keep critical content inside platform-safe areas and legible at the smallest intended display size.
- Respect accessibility for interactive work: semantic structure, keyboard use, visible focus, contrast, reduced motion, and usable touch targets.
- Avoid unnecessary decoration, arbitrary gradients, and style choices that could belong to any brief.
- Never force a white background, fixed font count, CTA position, or text percentage unless the user's brief or platform specification requires it.

## Built-in scripts

The logo, CIP, and icon folders contain optional search and generation helpers. Resolve paths relative to this skill directory and inspect a script's requirements before running it. Treat external API calls and dependency installation as optional capabilities that may require credentials or approval. If a helper fails, diagnose it; do not silently rewrite unrelated tooling.

Useful entrypoints:

- `scripts/logo/search.py` and `scripts/logo/generate.py`
- `scripts/cip/search.py`, `scripts/cip/generate.py`, and `scripts/cip/render-html.py`
- `scripts/icon/generate.py`

## Additional references

- [Design routing details](references/design-routing.md)
- [Logo styles](references/logo-style-guide.md), [color considerations](references/logo-color-psychology.md), and [prompt guidance](references/logo-prompt-engineering.md)
- [CIP deliverables](references/cip-deliverable-guide.md), [styles](references/cip-style-guide.md), and [prompt guidance](references/cip-prompt-engineering.md)
- [Slide layouts](references/slides-layout-patterns.md), [HTML template](references/slides-html-template.md), [copywriting](references/slides-copywriting-formulas.md), and [strategy](references/slides-strategies.md)
