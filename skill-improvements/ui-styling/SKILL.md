---
name: ui-styling
description: Implement or refine accessible interfaces in projects that use shadcn/ui, Radix UI, or Tailwind CSS. Use for component composition, responsive layout, theming, interaction states, and design-token application; do not use merely because a task involves generic frontend code or a non-UI canvas graphic.
license: MIT
metadata:
  author: claudekit
  version: "1.1.0"
---

# UI Styling

Improve the interface within the project's existing architecture and visual language. Inspect the package versions, component conventions, tokens, and nearby screens before choosing APIs or styles. Do not install shadcn/ui, replace a component library, or introduce a new theme unless the request requires it.

## Workflow

1. Locate the relevant component, styles, design tokens, and existing primitives.
2. Establish the screen's information hierarchy and states: default, hover, focus, active, disabled, loading, empty, error, and success where applicable.
3. Reuse accessible project primitives. Compose Radix or shadcn components instead of rebuilding interaction behavior with generic elements.
4. Implement responsive behavior from the content's constraints, not from a stock breakpoint pattern. Preserve usable reading widths, touch targets, and overflow behavior.
5. Verify the rendered UI at representative desktop and mobile sizes. Exercise keyboard navigation, focus order, dialogs or popovers, validation, dark mode if supported, and reduced motion.
6. Fix observed regressions before handing off.

## Design decisions

- Prefer the project's semantic tokens over raw palette utilities. Add a token only when the concept recurs or carries semantic meaning.
- Use spacing and typography to establish hierarchy before adding borders, shadows, gradients, or animation.
- Keep component variants purposeful and few. Avoid one-off boolean props when a composable child or established variant expresses the behavior better.
- Preserve user content and product terminology. Controls should name the action they perform; errors should state what happened and how to recover.
- Use motion to explain state change or spatial relationship. Respect `prefers-reduced-motion`.
- Treat dark mode as a semantic theme, not an inversion. Verify contrast and elevation in both themes.

## Accessibility invariants

- Use semantic HTML and native controls where possible.
- Every interactive element must be keyboard reachable with a visible focus state.
- Icon-only controls require an accessible name; decorative icons must be hidden from assistive technology.
- Inputs need persistent labels and errors associated programmatically with the field.
- Dialogs, menus, comboboxes, and tooltips need correct focus and dismissal behavior; rely on tested primitives.
- Do not communicate state by color alone.

## Tailwind and shadcn guidance

- Confirm the installed Tailwind and shadcn versions before using version-specific syntax or CLI commands.
- Keep class composition readable and consistent with the repository's helper conventions.
- Avoid runtime-generated class fragments that the build cannot detect.
- Modify generated shadcn components deliberately: local ownership permits changes, but broad edits can affect every consumer.
- Use arbitrary values only for genuinely bespoke geometry; prefer shared tokens for repeated values.

## References

Read only what the task needs:

- [Component composition](references/shadcn-components.md)
- [Theming](references/shadcn-theming.md)
- [Accessibility](references/shadcn-accessibility.md)
- [Tailwind utilities](references/tailwind-utilities.md)
- [Responsive behavior](references/tailwind-responsive.md)
- [Tailwind customization](references/tailwind-customization.md)

The bundled helper scripts are optional. Inspect their assumptions before running them, especially in projects whose framework or Tailwind version differs from the script's defaults.
