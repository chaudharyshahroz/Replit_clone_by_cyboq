# Deterministic Design Lint

`auditDesignQuality` runs on generated source before a build can be considered visually approved.

Blocking examples include missing H1/action/media, raw marketing empty states, destructive word wrapping, collapsed hero columns, unmanaged generated media, broken compiler contract usage, fake catalogue availability, hydration-unsafe first renders, emoji UI icons, generic marketing copy, fabricated counters, and nested card structures.

Warnings include unearned bento layouts, uncontrolled radius families, excessive shadow families, and weak genericity signals. Product grids are not rejected merely for repeating cards; repetition is judged in context.

Lint findings are structured as `{code, severity, message, paths}` and become targeted repair instructions. They are also stored with quality evidence for inspection.
