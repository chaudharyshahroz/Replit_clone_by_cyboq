# Coffino: supplied screenshot comparison

Evidence: user-provided screenshots 1–11 (Reklu), 12–16 (Replit), 2026-09-04. Static desktop evidence only; no mobile, keyboard, checkout or performance claims.

| Screen | Observation                                                              | General engine requirement                                            |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1      | Six-line oversized hero, blank right side, action below viewport         | Content-fitting type, bounded split hero, critical-media gate         |
| 2      | Useful three-column proof, but hero action delayed and arrow wraps       | Preserve familiar grids; inline-flex controls                         |
| 3      | Broken story photo; oversized icon containers                            | Decode validation and fixed optical icon sizing                       |
| 4–5    | Missing product photos and large blank slots                             | Asset status must not equal URL existence                             |
| 6      | Six narrow category cards force word-by-word paragraphs                  | Content-based minimum card widths and adaptive columns                |
| 7–8    | Broken story media and stacked giant heading                             | Separate section typography from hero type; media fallback and repair |
| 9      | Readable testimonials but excessive heading/card height                  | Bounded hierarchy and readable content widths                         |
| 10     | White copy on cream is nearly invisible                                  | Paired semantic foreground/background tokens and contrast gate        |
| 11     | Coherent footer; relatively small supporting text                        | Preserve working structure; validate responsive readability           |
| 12     | Replit: balanced serif hero, loaded image, visible CTA, coherent palette | Learn composition and hierarchy, not exact brand styling              |
| 13     | Editorial narrative with controlled width                                | Match composition to content length                                   |
| 14     | Good merchandising grid BUT cyclist photo represents coffee              | Relevance gate in addition to HTTP/decode checks                      |
| 15     | Balanced visit section, but repeats hero latte photo                     | Prefer location-specific assets for venue information                 |
| 16     | Cohesive closing band/footer                                             | Carry semantic tokens through every section                           |

The benchmark is not flawless. Do not copy its unrelated photograph, business claims, layout or branding. A coffee site, developer tool, gym and finance application should share quality invariants, not a visual template.

Exact regression prompt: “Let's build a landing page for my business that is coffe shop. Coffino is the name. Make sure design full website include all pages and section and also include online shop function etc”.
