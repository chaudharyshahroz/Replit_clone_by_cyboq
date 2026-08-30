/**
 * Turn the vendored CSVs into a typed module.
 *
 * The data is read at build time and shipped as TypeScript rather than parsed
 * at runtime, for one practical reason: generation runs inside a container that
 * has the compiled application and nothing else, so a code path that opens a
 * CSV relative to `import.meta.url` works locally and throws in production.
 *
 * Run with: pnpm --filter @reklu/build design:data
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, '..', 'vendor', 'ui-ux-pro-max');
const out = join(here, '..', 'src', 'design-data.ts');

/**
 * A CSV reader that handles quoted fields containing commas and newlines.
 *
 * Every column in this data set has prose in it, so splitting on commas
 * produces garbage — the palettes come back with hex values in the wrong roles,
 * which is exactly the sort of failure that looks fine until a page is
 * rendered.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
}

function readTable(name: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(join(vendor, `${name}.csv`), 'utf8'));
  const [header, ...body] = rows;
  if (!header) throw new Error(`${name}.csv is empty`);

  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((column, index) => {
      record[column.trim()] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

/** Comma or slash separated keywords, lowercased and de-duplicated. */
function keywords(value: string): string[] {
  const parts = value
    .split(/[,/;]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 1);
  return [...new Set(parts)];
}

const products = readTable('products');
const colors = readTable('colors');
const styles = readTable('styles');
const typography = readTable('typography');
const landing = readTable('landing');
const guidelines = readTable('ux-guidelines');
const charts = readTable('charts');

/*
 * The two tables are joined on the product type rather than on row order.
 * They happen to be parallel today; relying on that would mean an upstream
 * insertion silently pairs every product with the wrong palette.
 */
const paletteByType = new Map(colors.map((row) => [row['Product Type'], row]));
const missing = products.filter((row) => !paletteByType.has(row['Product Type']));
if (missing.length > 0) {
  throw new Error(
    `No palette for: ${missing.map((row) => row['Product Type']).join(', ')}. ` +
      'colors.csv and products.csv have diverged upstream.',
  );
}

const q = (value: string) => JSON.stringify(value ?? '');
const list = (values: string[]) => `[${values.map((value) => q(value)).join(', ')}]`;

const productEntries = products.map((row) => {
  const palette = paletteByType.get(row['Product Type']) as Record<string, string>;
  return `  {
    type: ${q(row['Product Type'])},
    keywords: ${list(keywords(row['Keywords']))},
    primaryStyle: ${q(row['Primary Style Recommendation'])},
    secondaryStyles: ${q(row['Secondary Styles'])},
    landingPattern: ${q(row['Landing Page Pattern'])},
    dashboardStyle: ${q(row['Dashboard Style (if applicable)'])},
    paletteFocus: ${q(row['Color Palette Focus'])},
    considerations: ${q(row['Key Considerations'])},
    palette: {
      primary: ${q(palette['Primary'])},
      onPrimary: ${q(palette['On Primary'])},
      secondary: ${q(palette['Secondary'])},
      onSecondary: ${q(palette['On Secondary'])},
      accent: ${q(palette['Accent'])},
      onAccent: ${q(palette['On Accent'])},
      background: ${q(palette['Background'])},
      foreground: ${q(palette['Foreground'])},
      card: ${q(palette['Card'])},
      cardForeground: ${q(palette['Card Foreground'])},
      muted: ${q(palette['Muted'])},
      mutedForeground: ${q(palette['Muted Foreground'])},
      border: ${q(palette['Border'])},
      destructive: ${q(palette['Destructive'])},
      onDestructive: ${q(palette['On Destructive'])},
      ring: ${q(palette['Ring'])},
      notes: ${q(palette['Notes'])},
    },
  },`;
});

const styleEntries = styles.map(
  (row) => `  {
    name: ${q(row['Style Category'])},
    keywords: ${list(keywords(row['Keywords']))},
    effects: ${q(row['Effects & Animation'])},
    bestFor: ${q(row['Best For'])},
    avoidFor: ${q(row['Do Not Use For'])},
    darkMode: ${q(row['Dark Mode ✓'])},
    accessibility: ${q(row['Accessibility'])},
    complexity: ${q(row['Complexity'])},
    cssKeywords: ${q(row['CSS/Technical Keywords'])},
    checklist: ${q(row['Implementation Checklist'])},
    tokens: ${q(row['Design System Variables'])},
  },`,
);

/*
 * Pairings whose URL does not load the families they name are dropped.
 *
 * Two of them pair Fontshare families — Satoshi, General Sans, Clash Display —
 * with a Google Fonts URL that quietly loads a substitute. Passed to a model as
 * "use Satoshi, load it with this URL", the page renders in a fallback or the
 * model invents an import for a family that is not there. A font that does not
 * load is the failure this whole table exists to prevent, so an entry that
 * causes it is worse than no entry.
 */
const usableFonts = typography.filter((row) => {
  const url = row['Google Fonts URL'].replace(/\+/g, ' ');
  return url.includes(row['Heading Font']) && url.includes(row['Body Font']);
});

const droppedFonts = typography.length - usableFonts.length;

const fontEntries = usableFonts.map(
  (row) => `  {
    name: ${q(row['Font Pairing Name'])},
    heading: ${q(row['Heading Font'])},
    body: ${q(row['Body Font'])},
    mood: ${list(keywords(row['Mood/Style Keywords']))},
    bestFor: ${q(row['Best For'])},
    googleFontsUrl: ${q(row['Google Fonts URL'])},
    notes: ${q(row['Notes'])},
  },`,
);

const landingEntries = landing.map(
  (row) => `  {
    name: ${q(row['Pattern Name'])},
    keywords: ${list(keywords(row['Keywords']))},
    sectionOrder: ${q(row['Section Order'])},
    ctaPlacement: ${q(row['Primary CTA Placement'])},
    colorStrategy: ${q(row['Color Strategy'])},
    conversion: ${q(row['Conversion Optimization'])},
  },`,
);

/*
 * Only the severities worth a place in a prompt. Every line added here costs
 * tokens on every generation and dilutes the ones that matter, and a "Low"
 * rule that displaces a "Critical" one is a net loss.
 */
const ruleEntries = guidelines
  .filter((row) => row['Severity'] === 'Critical' || row['Severity'] === 'High')
  .map(
    (row) => `  {
    category: ${q(row['Category'])},
    issue: ${q(row['Issue'])},
    platform: ${q(row['Platform'])},
    doThis: ${q(row['Do'])},
    notThis: ${q(row["Don't"])},
    severity: ${q(row['Severity'])},
  },`,
  );

const chartEntries = charts.map(
  (row) => `  {
    dataType: ${q(row['Data Type'])},
    keywords: ${list(keywords(row['Keywords']))},
    chart: ${q(row['Best Chart Type'])},
    whenToUse: ${q(row['When to Use'])},
    whenNotTo: ${q(row['When NOT to Use'])},
    accessibility: ${q(row['Accessibility Notes'])},
  },`,
);

const source = `/**
 * Design data, generated. Do not edit.
 *
 * Emitted by scripts/build-design-data.mts from vendor/ui-ux-pro-max/*.csv,
 * which is ui-ux-pro-max-skill under the MIT licence — see the LICENCE beside
 * those files. Change the CSVs and re-run the script; editing this file means
 * the next refresh silently reverts you.
 */

export interface Palette {
  readonly primary: string;
  readonly onPrimary: string;
  readonly secondary: string;
  readonly onSecondary: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly background: string;
  readonly foreground: string;
  readonly card: string;
  readonly cardForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly destructive: string;
  readonly onDestructive: string;
  readonly ring: string;
  /** Why these colours, including any WCAG adjustment made upstream. */
  readonly notes: string;
}

export interface ProductProfile {
  readonly type: string;
  readonly keywords: readonly string[];
  readonly primaryStyle: string;
  readonly secondaryStyles: string;
  readonly landingPattern: string;
  readonly dashboardStyle: string;
  readonly paletteFocus: string;
  readonly considerations: string;
  readonly palette: Palette;
}

export interface StyleProfile {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly effects: string;
  readonly bestFor: string;
  readonly avoidFor: string;
  readonly darkMode: string;
  readonly accessibility: string;
  readonly complexity: string;
  readonly cssKeywords: string;
  readonly checklist: string;
  readonly tokens: string;
}

export interface FontPairing {
  readonly name: string;
  readonly heading: string;
  readonly body: string;
  readonly mood: readonly string[];
  readonly bestFor: string;
  /** The exact URL, with the weights the families actually publish. */
  readonly googleFontsUrl: string;
  readonly notes: string;
}

export interface LandingPattern {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly sectionOrder: string;
  readonly ctaPlacement: string;
  readonly colorStrategy: string;
  readonly conversion: string;
}

export interface UxRule {
  readonly category: string;
  readonly issue: string;
  readonly platform: string;
  readonly doThis: string;
  readonly notThis: string;
  readonly severity: string;
}

export interface ChartChoice {
  readonly dataType: string;
  readonly keywords: readonly string[];
  readonly chart: string;
  readonly whenToUse: string;
  readonly whenNotTo: string;
  readonly accessibility: string;
}

export const PRODUCT_PROFILES: readonly ProductProfile[] = [
${productEntries.join('\n')}
];

export const STYLE_PROFILES: readonly StyleProfile[] = [
${styleEntries.join('\n')}
];

export const FONT_PAIRINGS: readonly FontPairing[] = [
${fontEntries.join('\n')}
];

export const LANDING_PATTERNS: readonly LandingPattern[] = [
${landingEntries.join('\n')}
];

export const UX_RULES: readonly UxRule[] = [
${ruleEntries.join('\n')}
];

export const CHART_CHOICES: readonly ChartChoice[] = [
${chartEntries.join('\n')}
];
`;

writeFileSync(out, source);

console.log(
  `design-data.ts — ${products.length} products, ${styles.length} styles, ` +
    `${usableFonts.length} font pairings (${droppedFonts} dropped: URL did not load the ` +
    `families named), ${landing.length} landing patterns, ` +
    `${ruleEntries.length} rules (of ${guidelines.length}), ${charts.length} chart types`,
);
