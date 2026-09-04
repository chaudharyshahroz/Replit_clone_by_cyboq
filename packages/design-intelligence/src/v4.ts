import { z } from 'zod';
import { DesignDNASchema, ProductDesignContextSchema, type ProductDesignContext } from './schemas';
import { createDesignDNA } from './dna';

/** One versioned authority. V1 DNA/V3 records remain readable but are not mixed into V4 prompts. */
export const DesignEngineV4Schema = z.object({
  version: z.literal(4),
  product: ProductDesignContextSchema,
  dna: DesignDNASchema,
  selection: z.object({
    method: z.literal('curated-rules'),
    profile: z.string(),
    reason: z.string(),
  }),
  content: z.object({
    promise: z.string(),
    primaryAction: z.string(),
    evidence: z.array(z.string()),
    policy: z.array(z.string()),
  }),
  storyboard: z.array(
    z.object({
      id: z.string(),
      purpose: z.string(),
      composition: z.string(),
      media: z.enum(['critical', 'optional', 'none']),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string(),
      sectionId: z.string(),
      priority: z.enum(['critical', 'optional']),
      subject: z.string(),
      aspectRatio: z.string(),
      fit: z.enum(['cover', 'contain']),
      status: z.literal('planned'),
    }),
  ),
  layout: z.object({
    container: z.number(),
    cardMin: z.number(),
    heroMaxLines: z.number(),
    sectionMaxLines: z.number(),
    mobileMaxLines: z.number(),
  }),
});
export type DesignEngineV4 = z.infer<typeof DesignEngineV4Schema>;

const profiles = {
  restaurant: [
    'sensory-editorial',
    'Fraunces',
    '#F6F0E7',
    '#282019',
    '#31584B',
    '#FFFFFF',
    '#A7472D',
    'image-led-split',
  ],
  fitness: [
    'performance-club',
    'Barlow Condensed',
    '#F0EFEA',
    '#20211F',
    '#8C341D',
    '#FFFFFF',
    '#505C3B',
    'cinematic-split',
  ],
  fashion: [
    'fashion-journal',
    'Bodoni Moda',
    '#F8F5F0',
    '#26201F',
    '#382F32',
    '#FFFFFF',
    '#943C54',
    'editorial-campaign',
  ],
  developer_tool: [
    'technical-workbench',
    'Space Grotesk',
    '#0B1017',
    '#EAF1F7',
    '#62D9C6',
    '#071310',
    '#9BADFF',
    'code-demo-split',
  ],
  fintech: [
    'financial-precision',
    'IBM Plex Sans',
    '#F2F5F9',
    '#14243A',
    '#214C86',
    '#FFFFFF',
    '#755D26',
    'data-evidence-split',
  ],
  saas: [
    'product-demonstration',
    'Manrope',
    '#F7F8FC',
    '#22273B',
    '#4746A8',
    '#FFFFFF',
    '#86520D',
    'product-demo',
  ],
  commerce: [
    'product-gallery',
    'DM Sans',
    '#F8F7F3',
    '#222B26',
    '#385B40',
    '#FFFFFF',
    '#92522B',
    'merchandising-split',
  ],
  portfolio: [
    'selected-work',
    'Space Grotesk',
    '#F7F4ED',
    '#272424',
    '#783637',
    '#FFFFFF',
    '#495F91',
    'work-led-editorial',
  ],
  agency: [
    'studio-index',
    'Syne',
    '#F5F5EE',
    '#202921',
    '#36533D',
    '#FFFFFF',
    '#8B4133',
    'project-index',
  ],
  healthcare: [
    'human-care',
    'Source Sans 3',
    '#F3F8F7',
    '#163630',
    '#266452',
    '#FFFFFF',
    '#6C5085',
    'service-and-people',
  ],
} as const;

/** Rule selection is labeled honestly; there are no fabricated candidate/vision scores. */
export function createDesignEngineV4(product: ProductDesignContext): DesignEngineV4 {
  const key =
    product.productType in profiles ? (product.productType as keyof typeof profiles) : 'saas';
  const [profile, font, background, foreground, primary, onPrimary, accent, hero] = profiles[key];
  const dna = createDesignDNA(product);
  dna.directionId = profile;
  dna.visualDirection = `${profile}: ${product.visualTone.join(', ')}; ${hero}`;
  dna.typography = {
    ...dna.typography,
    display: font,
    body: key === 'fintech' ? 'IBM Plex Sans' : 'Source Sans 3',
    displayWeight: 600,
    scale: [14, 16, 20, 28, 40, 72],
  };
  dna.colors = {
    ...dna.colors,
    background,
    surface: background,
    surfaceRaised: key === 'developer_tool' ? '#172331' : '#FFFFFF',
    text: foreground,
    muted: key === 'developer_tool' ? '#A7B7C8' : '#585D63',
    primary,
    onPrimary,
  };
  dna.containerWidths = { content: 720, wide: 1280 };
  const photographic = [
    'restaurant',
    'fitness',
    'fashion',
    'commerce',
    'portfolio',
    'agency',
    'healthcare',
  ].includes(key);
  const storyboard: DesignEngineV4['storyboard'] = [
    {
      id: 'arrival',
      purpose: product.primaryGoal,
      composition: hero,
      media: photographic ? 'critical' : 'none',
    },
    {
      id: 'evidence',
      purpose: product.trustRequirements.join('; '),
      composition: photographic ? 'media-gallery' : 'interactive-product-evidence',
      media: photographic ? 'critical' : 'none',
    },
    {
      id: 'detail',
      purpose: product.secondaryGoals.join('; '),
      composition: 'editorial-split',
      media: photographic ? 'optional' : 'none',
    },
    {
      id: 'action',
      purpose: product.conversionGoal,
      composition: 'compact-contrast-band',
      media: 'none',
    },
  ];
  return DesignEngineV4Schema.parse({
    version: 4,
    product,
    dna,
    selection: {
      method: 'curated-rules',
      profile,
      reason: `${product.industry}; ${product.primaryGoal}. Accent ${accent}. User-supplied brand constraints take precedence; never claim this is a measured visual benchmark.`,
    },
    content: {
      promise: product.primaryGoal,
      primaryAction: product.primaryCTA,
      evidence: product.trustRequirements,
      policy: [
        'Use short product-specific copy; heading length determines composition.',
        'Do not fabricate customers, testimonials, certifications, founder history or performance claims.',
        'Mark representative commerce data as demo until connected. Never pretend checkout succeeded.',
      ],
    },
    storyboard,
    assets: storyboard
      .filter((s) => s.media !== 'none')
      .map((s) => ({
        id: `${s.id}-media`,
        sectionId: s.id,
        priority: s.media,
        subject: `${product.industry}: ${s.purpose}. Match the actual subject, not just color or search keywords.`,
        aspectRatio: s.id === 'arrival' ? '4 / 5' : '4 / 3',
        fit: 'cover',
        status: 'planned',
      })),
    layout: {
      container: 1280,
      cardMin: 240,
      heroMaxLines: 4,
      sectionMaxLines: 3,
      mobileMaxLines: 5,
    },
  });
}

export function designEngineV4Prompt(engine: DesignEngineV4): string {
  return [
    'REKLU DESIGN ENGINE V4 — authoritative design contract. Do not combine with another palette/type recipe.',
    JSON.stringify(engine),
    'The compiler supplies src/app/reklu-design.css (or app/reklu-design.css) and src/components/reklu/BrandImage.tsx (or components/reklu/BrandImage.tsx). Do not rewrite those files.',
    'Use rk-container, rk-section, rk-hero, rk-hero-title, rk-section-title, rk-grid, rk-button and rk-surface-primary classes. They are plain CSS, not Tailwind plugins. Use data-section-id matching the storyboard.',
    'rk-hero is a two-column layout; give it exactly two direct children: copy/actions and media/demo. Use rk-grid for normal product lists; never use six skinny paragraph cards. Do not add fixed card widths.',
    'Import BrandImage from the provided components/reklu path for photos and products. Declare requested imagery with literal src="/generated/descriptive-name.png" and detailed literal alt text so the asset service can fulfill it. Never invent remote image IDs. Use role="critical" for hero/product media. Loading/fallback media is not final completion.',
    'Keep headings concise. Desktop hero 2–4 lines, section 1–3; mobile at most 5. Do not force br tags or one-word lines. Never apply viewport-wide type sizes inside a narrow column.',
    'Use CSS variables --color-background, --color-foreground, --color-primary, --color-on-primary. Use paired colors on every contrast surface. No white text on an unresolved image background.',
    'Use real SVG icons from one installed family, 20–24px, inline with labels; never emoji icons. Reduced motion must preserve visible content.',
    'Preserve familiar navigation, product grids, pricing tables and forms. Distinction comes from brand, composition, content and imagery, not breaking useful grids.',
    'One meaningful first viewport with heading, action and media/demo. No full-height empty sections. First preview is interactive; final quality is a separate evidence-based gate.',
  ].join('\n');
}

/** Plain CSS works independently of Tailwind version/content scanning. */
export function compileDesignStyles(engine: DesignEngineV4): string {
  const { dna } = engine;
  const serif = /Fraunces|Bodoni/.test(dna.typography.display);
  // Browser-loaded fonts never make preview startup depend on a font download.
  // Only compiler-curated families are requested; arbitrary imported names use fallbacks.
  const knownFonts = new Set<string>([
    ...Object.values(profiles).map((profile) => profile[1]),
    'Source Sans 3',
  ]);
  const families = [...new Set([dna.typography.display, dna.typography.body])].filter((font) =>
    knownFonts.has(font),
  );
  const fontImport = families.length
    ? `@import url("https://fonts.googleapis.com/css2?${families.map((font) => `family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;600;700`).join('&')}&display=swap");`
    : '';
  return `/* Reklu Design Engine V4: compiler-owned */
${fontImport}
:root {
  --rk-ink: ${dna.colors.text}; --rk-paper: ${dna.colors.background}; --rk-brand: ${dna.colors.primary};
  --color-background: var(--rk-paper); --color-foreground: var(--rk-ink);
  --color-primary: var(--rk-brand); --color-on-primary: ${dna.colors.onPrimary};
  --color-surface: ${dna.colors.surfaceRaised}; --color-muted-foreground: ${dna.colors.muted};
  --font-display: "${dna.typography.display}", ${serif ? 'Georgia, serif' : 'system-ui, sans-serif'};
  --font-body: "${dna.typography.body}", system-ui, sans-serif;
  --type-hero: clamp(2.5rem, 1.5rem + 3.3vw, 4.5rem);
  --type-h1: var(--type-hero); --type-h2: clamp(2rem, 1.3rem + 1.6vw, 3rem);
  --type-h3: clamp(1.25rem, 1rem + .6vw, 1.5rem); --type-body: 1rem;
  --spacing-section: clamp(3.5rem, 6vw, 6.5rem); --spacing-gutter: clamp(1.25rem, 3vw, 3rem);
  --button-bg: var(--color-primary); --button-fg: var(--color-on-primary);
  --card-padding: 1.5rem; --card-radius: ${dna.radius.md}px;
}
:where(body) { margin: 0; background: var(--color-background); color: var(--color-foreground); font-family: var(--font-body); font-size: var(--type-body); line-height: 1.6; }
.rk-container, .rk-container *, .rk-button, .rk-media { box-sizing: border-box; }
:where(h1,h2,h3) { font-family: var(--font-display); line-height: 1.1; text-wrap: balance; overflow-wrap: break-word; }
:where(h1) { font-size: var(--type-h1); }
:where(h2) { font-size: var(--type-h2); }
:where(h3) { font-size: var(--type-h3); }
.rk-container { width: min(calc(100% - 2 * var(--spacing-gutter)), ${engine.layout.container}px); margin-inline: auto; }
.rk-section { padding-block: var(--spacing-section); }
.rk-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(2rem, 5vw, 5rem); align-items: center; padding-block: var(--spacing-section); }
.rk-hero > * { min-width: 0; }
.rk-hero-title { font-size: var(--type-hero); max-width: 20ch; line-height: 1.04; margin-block: 0 1.5rem; }
.rk-section-title { font-size: var(--type-h2); max-width: 28ch; margin-block: 0 1.5rem; }
.rk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, ${engine.layout.cardMin}px), 1fr)); gap: 1.5rem; align-items: stretch; }
.rk-grid > * { min-width: 0; }
.rk-button { display: inline-flex; align-items: center; justify-content: center; gap: .625rem; min-height: 44px; padding: .75rem 1.5rem; background: var(--button-bg); color: var(--button-fg); border: 1px solid transparent; border-radius: ${dna.radius.sm}px; text-decoration: none; font: inherit; font-weight: 600; cursor: pointer; }
.rk-button svg { width: 20px; height: 20px; flex: none; }
.rk-button:hover { filter: brightness(.92); }
.rk-button:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
.rk-button:disabled { opacity: .55; cursor: not-allowed; }
.rk-surface-primary { background: var(--color-primary); color: var(--color-on-primary); }
.rk-media { display: grid; overflow: hidden; background: var(--color-surface); color: var(--color-foreground); border-radius: var(--card-radius); }
.rk-media img { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
.rk-media-fallback { padding: 1.5rem; align-self: center; text-align: center; }
@media (max-width: 767px) { .rk-hero { grid-template-columns: minmax(0, 1fr); } .rk-hero-title { max-width: 100%; } }
@media (prefers-reduced-motion: reduce) { .rk-button { transition: none; } [data-section-id] { scroll-behavior: auto; } }
`;
}
