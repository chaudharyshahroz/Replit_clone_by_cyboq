# ui-ux-pro-max — vendored design data

Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT).

Seven CSVs, copied unmodified, are the input to `scripts/build-design-data.mts`,
which emits `src/design-data.ts`. Nothing reads these files at runtime — the
generated module ships, so a build never depends on a file path inside a
container.

They are kept rather than discarded after generation for two reasons: the MIT
licence asks that the source travel with the copy, and a diff against a newer
upstream release is the only way to see what actually changed.

| File | Rows | Used for |
|---|---|---|
| `products.csv` | 192 | product type → recommended style, landing pattern, palette focus |
| `colors.csv` | 192 | the palette for each product type, sixteen roles, WCAG-checked |
| `styles.csv` | 84 | visual styles with CSS keywords, checklists and token names |
| `typography.csv` | 74 | font pairings with the exact Google Fonts URL and weights |
| `landing.csv` | 34 | landing page section order and CTA placement |
| `ux-guidelines.csv` | 99 | checkable do/don't rules by severity |
| `charts.csv` | 25 | chart choice by data shape, with accessibility grade |

## Refreshing

    cp <upstream>/data/{products,colors,styles,typography,landing,ux-guidelines,charts}.csv .
    pnpm --filter @reklu/build design:data

Then run the tests. `design-selection.test.ts` asserts on real rows, so a
renamed product type or a dropped column fails there rather than silently
changing what every generated site looks like.
