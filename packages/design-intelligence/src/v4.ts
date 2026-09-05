import { z } from 'zod';
import { DesignDNASchema, ProductDesignContextSchema, type ProductDesignContext } from './schemas';
import { createDesignDNA } from './dna';

/** One versioned authority. V1 DNA/V3 records remain readable but are not mixed into V4 prompts. */
export const DesignEngineV4Schema = z.object({
  version: z.literal(4),
  revision: z.number().int().positive().default(1),
  product: ProductDesignContextSchema,
  dna: DesignDNASchema,
  selection: z.object({
    method: z.literal('curated-rules'),
    profile: z.string(),
    reason: z.string(),
    componentStyle: z.enum(['editorial', 'soft', 'technical', 'sculpted']).default('editorial'),
    signature: z.string().default('subject-led composition'),
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

type ComponentStyle = 'editorial' | 'soft' | 'technical' | 'sculpted';
type ProfileVariant = Readonly<{
  profile: string;
  display: string;
  body: string;
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  primary: string;
  onPrimary: string;
  accent: string;
  hero: string;
  componentStyle: ComponentStyle;
  signature: string;
}>;

const variant = (
  ...values: readonly [
    profile: string,
    display: string,
    body: string,
    background: string,
    surface: string,
    foreground: string,
    muted: string,
    primary: string,
    onPrimary: string,
    accent: string,
    hero: string,
    signature: string,
  ]
): ProfileVariant => {
  const [
    profile,
    display,
    body,
    background,
    surface,
    foreground,
    muted,
    primary,
    onPrimary,
    accent,
    hero,
    signature,
  ] = values;
  const componentStyles: readonly ComponentStyle[] = ['editorial', 'soft', 'technical', 'sculpted'];
  const componentStyle = componentStyles[stableVariantIndex(profile, componentStyles.length)]!;
  return {
    profile,
    display,
    body,
    background,
    surface,
    foreground,
    muted,
    primary,
    onPrimary,
    accent,
    hero,
    componentStyle,
    signature,
  };
};

/** Curated families vary within an industry without sacrificing contrast or coherence. */
const profiles = {
  restaurant: [
    variant(
      'neighbourhood-ledger',
      'Newsreader',
      'Source Sans 3',
      '#F3EBDD',
      '#FFF9EF',
      '#2A211B',
      '#6F6258',
      '#285C4D',
      '#FFFFFF',
      '#C35235',
      'offset-counter-split',
      'A handwritten-scale daily-special rail crossing documentary food photography',
    ),
    variant(
      'after-hours-salon',
      'Cormorant Garamond',
      'DM Sans',
      '#1D171C',
      '#292128',
      '#F5EBDD',
      '#BDAFAE',
      '#C6A15B',
      '#1D171C',
      '#7D2946',
      'cinematic-full-bleed-window',
      'A brass reservation marker cut into low-light room photography',
    ),
    variant(
      'daylight-canteen',
      'Fraunces',
      'Libre Franklin',
      '#EAF0E8',
      '#FBFCF7',
      '#172C31',
      '#55686B',
      '#E05432',
      '#FFFFFF',
      '#2C6F83',
      'modular-photo-collage',
      'A cobalt menu tab system paired with sunlit ingredient crops',
    ),
  ],
  fitness: [
    variant(
      'kinetic-discipline',
      'Barlow Condensed',
      'Libre Franklin',
      '#EAE9E3',
      '#F7F6F1',
      '#1E211F',
      '#5C625E',
      '#9E3F24',
      '#FFFFFF',
      '#465B45',
      'cinematic-split',
      'A vertical training-log rail aligned to documentary movement frames',
    ),
    variant(
      'human-output-journal',
      'Sora',
      'Source Sans 3',
      '#F3F6F4',
      '#FFFFFF',
      '#172329',
      '#5D696D',
      '#2356A4',
      '#FFFFFF',
      '#E86B35',
      'annotated-action-frame',
      'Coach annotations trace one movement sequence across the page',
    ),
    variant(
      'private-strength-house',
      'Newsreader',
      'DM Sans',
      '#242320',
      '#302E29',
      '#F0EBDD',
      '#B9B1A2',
      '#B79758',
      '#171713',
      '#6F7B62',
      'architectural-membership-split',
      'A narrow brass session folio overlays quiet architectural photography',
    ),
  ],
  fashion: [
    variant(
      'cut-and-cadence',
      'Bodoni Moda',
      'DM Sans',
      '#F7F4EF',
      '#FFFFFF',
      '#251F1F',
      '#6C6160',
      '#2B2527',
      '#FFFFFF',
      '#9C3F58',
      'editorial-campaign',
      'Offset look captions interrupt one continuous runway crop',
    ),
    variant(
      'material-index',
      'Newsreader',
      'Libre Franklin',
      '#EEE8DD',
      '#FAF7F0',
      '#202727',
      '#606B68',
      '#335E55',
      '#FFFFFF',
      '#A55F2F',
      'material-detail-index',
      'Fabric swatches become the navigation and product filtering language',
    ),
    variant(
      'street-issue',
      'Syne',
      'Source Sans 3',
      '#F1F0EA',
      '#FFFFFF',
      '#121416',
      '#626568',
      '#D4492F',
      '#FFFFFF',
      '#31599B',
      'cover-story-grid',
      'Issue-style cover lines frame direct-flash collection photography',
    ),
  ],
  developer_tool: [
    variant(
      'executable-proof',
      'Space Grotesk',
      'IBM Plex Sans',
      '#0B1017',
      '#172331',
      '#EAF1F7',
      '#A7B7C8',
      '#62D9C6',
      '#071310',
      '#9BADFF',
      'code-demo-split',
      'A live request-to-response trace forms the hero composition',
    ),
    variant(
      'protocol-manual',
      'IBM Plex Sans',
      'Source Sans 3',
      '#F3F5F2',
      '#FFFFFF',
      '#172027',
      '#5C6971',
      '#2557A7',
      '#FFFFFF',
      '#C77A20',
      'specification-sheet',
      'Margin specifications connect each claim to working code evidence',
    ),
    variant(
      'systems-observatory',
      'Sora',
      'IBM Plex Sans',
      '#101526',
      '#192139',
      '#F0F3FA',
      '#ADB6CA',
      '#80D6B2',
      '#0D1814',
      '#8E86FF',
      'layered-system-map',
      'One luminous system path responds to the selected capability',
    ),
  ],
  fintech: [
    variant(
      'measured-confidence',
      'IBM Plex Sans',
      'Source Sans 3',
      '#F2F5F9',
      '#FFFFFF',
      '#14243A',
      '#5F6D7D',
      '#214C86',
      '#FFFFFF',
      '#A6792E',
      'data-evidence-split',
      'A transparent fee and outcome ledger anchors the first viewport',
    ),
    variant(
      'open-ledger',
      'Newsreader',
      'IBM Plex Sans',
      '#F0EEE7',
      '#FBFAF5',
      '#202A30',
      '#657077',
      '#176A61',
      '#FFFFFF',
      '#B45A34',
      'ledger-proof-layout',
      'Ledger rules connect every promise to its term or safeguard',
    ),
    variant(
      'long-horizon',
      'Manrope',
      'Source Sans 3',
      '#E9F0EF',
      '#F8FBFA',
      '#15313A',
      '#587078',
      '#1D6675',
      '#FFFFFF',
      '#B49445',
      'planning-arc-split',
      'A single planning horizon arcs through goals, risk, and time',
    ),
  ],
  saas: [
    variant(
      'product-demonstration',
      'Manrope',
      'Source Sans 3',
      '#F7F8FC',
      '#FFFFFF',
      '#22273B',
      '#62687A',
      '#4746A8',
      '#FFFFFF',
      '#C07A28',
      'product-demo',
      'The real product interaction is the hero, not a decorative illustration',
    ),
    variant(
      'operating-canvas',
      'Sora',
      'DM Sans',
      '#EEF3F5',
      '#FFFFFF',
      '#17262D',
      '#5D6E75',
      '#087A75',
      '#FFFFFF',
      '#D8613D',
      'workflow-canvas',
      'A focused workflow expands step by step as the visitor reads',
    ),
    variant(
      'signal-room',
      'Space Grotesk',
      'IBM Plex Sans',
      '#151727',
      '#20243A',
      '#F3F4FA',
      '#B5B8CB',
      '#A9F27D',
      '#10150D',
      '#827CFF',
      'live-signal-panel',
      'A live signal panel proves the primary benefit with restrained motion',
    ),
  ],
  commerce: [
    variant(
      'product-gallery',
      'DM Sans',
      'Source Sans 3',
      '#F8F7F3',
      '#FFFFFF',
      '#222B26',
      '#667069',
      '#385B40',
      '#FFFFFF',
      '#B06232',
      'merchandising-split',
      'One hero product breaks the catalogue grid with material close-ups',
    ),
    variant(
      'makers-catalogue',
      'Newsreader',
      'Libre Franklin',
      '#EEE9DE',
      '#FBF8F1',
      '#29231E',
      '#6F655C',
      '#8A432F',
      '#FFFFFF',
      '#3F6A61',
      'maker-story-grid',
      'Maker marks and material notes become the product-card structure',
    ),
    variant(
      'color-block-market',
      'Syne',
      'DM Sans',
      '#F2F0E9',
      '#FFFFFF',
      '#18191C',
      '#636469',
      '#244DB3',
      '#FFFFFF',
      '#E45D37',
      'color-block-merchandising',
      'Category color fields create a bold but navigable shopping rhythm',
    ),
  ],
  portfolio: [
    variant(
      'selected-work',
      'Space Grotesk',
      'Source Sans 3',
      '#F7F4ED',
      '#FFFFFF',
      '#272424',
      '#686261',
      '#783637',
      '#FFFFFF',
      '#495F91',
      'work-led-editorial',
      'Project titles and crops interlock into one asymmetric index',
    ),
    variant(
      'studio-contact-sheet',
      'IBM Plex Sans',
      'DM Sans',
      '#ECEFED',
      '#FFFFFF',
      '#152126',
      '#5C6A70',
      '#1C6673',
      '#FFFFFF',
      '#CC633C',
      'contact-sheet',
      'A working contact sheet reveals project metadata on focus',
    ),
    variant(
      'monograph',
      'Cormorant Garamond',
      'Libre Franklin',
      '#201D1B',
      '#2B2724',
      '#F3EDE2',
      '#B9AFA2',
      '#D6B36A',
      '#1B1815',
      '#7A5A8A',
      'monograph-spread',
      'A restrained monograph spine persists through selected work',
    ),
  ],
  agency: [
    variant(
      'studio-index',
      'Syne',
      'Source Sans 3',
      '#F5F5EE',
      '#FFFFFF',
      '#202921',
      '#657068',
      '#36533D',
      '#FFFFFF',
      '#B2543D',
      'project-index',
      'Capabilities behave as an index into real project evidence',
    ),
    variant(
      'campaign-room',
      'Sora',
      'DM Sans',
      '#F0ECE8',
      '#FFFFFF',
      '#251D24',
      '#6E626A',
      '#7B3BA3',
      '#FFFFFF',
      '#E2683A',
      'campaign-collage',
      'A campaign wall assembles type, imagery, and outcomes into one scene',
    ),
    variant(
      'working-studio',
      'IBM Plex Sans',
      'Libre Franklin',
      '#E9EEF0',
      '#F8FAFB',
      '#14262E',
      '#596D75',
      '#086D75',
      '#FFFFFF',
      '#CA5638',
      'process-evidence-split',
      'A visible working process replaces the usual agency claims grid',
    ),
  ],
  healthcare: [
    variant(
      'human-care',
      'Source Sans 3',
      'Source Sans 3',
      '#F3F8F7',
      '#FFFFFF',
      '#163630',
      '#5F7670',
      '#266452',
      '#FFFFFF',
      '#7B5B96',
      'service-and-people',
      'A calm care-path navigator keeps human photography and next steps together',
    ),
    variant(
      'clinical-clarity',
      'IBM Plex Sans',
      'Source Sans 3',
      '#F1F5F7',
      '#FFFFFF',
      '#172D3C',
      '#60727E',
      '#23628A',
      '#FFFFFF',
      '#B66B32',
      'care-decision-layout',
      'Plain-language decision cards reveal eligibility and next steps progressively',
    ),
    variant(
      'neighbourhood-practice',
      'Newsreader',
      'Libre Franklin',
      '#F4F0E7',
      '#FFFCF6',
      '#24332C',
      '#68756E',
      '#34705A',
      '#FFFFFF',
      '#B95E46',
      'people-led-editorial',
      'Portraits, availability, and credentials share one approachable practice board',
    ),
  ],
  dashboard: [
    variant(
      'decision-console',
      'IBM Plex Sans',
      'Source Sans 3',
      '#EEF2F4',
      '#FFFFFF',
      '#15252D',
      '#5D6C73',
      '#1D6675',
      '#FFFFFF',
      '#D17A32',
      'priority-signal-board',
      'A single decision queue leads the information hierarchy instead of a wall of equal cards',
    ),
    variant(
      'operations-grid',
      'Space Grotesk',
      'IBM Plex Sans',
      '#111721',
      '#1B2533',
      '#EDF3F8',
      '#AAB8C5',
      '#77D6C1',
      '#0B1714',
      '#8D86F5',
      'dense-operating-grid',
      'Live status rails connect exceptions to the metrics and actions that resolve them',
    ),
    variant(
      'analyst-notebook',
      'Newsreader',
      'Libre Franklin',
      '#F3EFE7',
      '#FFFCF6',
      '#242823',
      '#676C66',
      '#566A3A',
      '#FFFFFF',
      '#A0523B',
      'annotated-analysis',
      'Editorial annotations explain one decisive chart before exposing deeper controls',
    ),
  ],
  application: [
    variant(
      'focused-workspace',
      'Sora',
      'DM Sans',
      '#EEF1F5',
      '#FFFFFF',
      '#19232E',
      '#626D79',
      '#4459B8',
      '#FFFFFF',
      '#D8693F',
      'task-first-workspace',
      'The primary task owns the canvas while navigation and context stay deliberately quiet',
    ),
    variant(
      'calm-utility',
      'Manrope',
      'Source Sans 3',
      '#EAF2EF',
      '#FAFCFB',
      '#19302D',
      '#60736E',
      '#177569',
      '#FFFFFF',
      '#B35E3F',
      'guided-task-flow',
      'A calm progress path keeps the next useful action visible at every step',
    ),
    variant(
      'command-surface',
      'Space Grotesk',
      'IBM Plex Sans',
      '#171722',
      '#242437',
      '#F3F1FA',
      '#B7B2C7',
      '#B7EF72',
      '#11160C',
      '#7D78F0',
      'command-led-shell',
      'A command surface links recent work, shortcuts, and contextual results without dashboard clutter',
    ),
  ],
  local_service: [
    variant(
      'neighbourhood-proof',
      'Newsreader',
      'Source Sans 3',
      '#F2EEE5',
      '#FFFCF5',
      '#28241F',
      '#70685E',
      '#2E6258',
      '#FFFFFF',
      '#BF5D3B',
      'service-and-place',
      'Local availability, real work, and a direct booking route share one grounded composition',
    ),
    variant(
      'trade-standard',
      'Barlow Condensed',
      'Libre Franklin',
      '#EBEFEF',
      '#FFFFFF',
      '#16282D',
      '#5A6D72',
      '#176E7B',
      '#FFFFFF',
      '#D36B2F',
      'before-after-proof',
      'Before-and-after evidence is organized like a precise job sheet, not a generic testimonial page',
    ),
    variant(
      'personal-practice',
      'Cormorant Garamond',
      'DM Sans',
      '#251F23',
      '#332B30',
      '#F4EDE4',
      '#BFB2B7',
      '#D1AA62',
      '#211B1E',
      '#80506C',
      'portrait-and-booking',
      'A practitioner portrait, philosophy, and appointment book form one intimate arrival',
    ),
  ],
  content: [
    variant(
      'current-issue',
      'Newsreader',
      'Libre Franklin',
      '#F5F1E8',
      '#FFFCF6',
      '#25231F',
      '#6D685F',
      '#9A3F36',
      '#FFFFFF',
      '#315C73',
      'cover-and-index',
      'A strong current story and compact issue index replace the generic article-card wall',
    ),
    variant(
      'broadcast-desk',
      'Sora',
      'Source Sans 3',
      '#101821',
      '#1A2632',
      '#EDF4F7',
      '#AABAC2',
      '#57D0BD',
      '#0C1715',
      '#F08A44',
      'live-programme-grid',
      'A live programme rail frames featured voices, timestamps, and the next episode',
    ),
    variant(
      'visual-journal',
      'Bodoni Moda',
      'DM Sans',
      '#EEE9E2',
      '#FBF8F2',
      '#211D1C',
      '#685F5C',
      '#3B554B',
      '#FFFFFF',
      '#A44C60',
      'image-led-journal',
      'Large editorial crops and terse captions create pacing instead of repeated content cards',
    ),
  ],
  other: [
    variant(
      'clear-proposition',
      'Manrope',
      'Source Sans 3',
      '#F2F4F2',
      '#FFFFFF',
      '#1D2725',
      '#626C69',
      '#2E6358',
      '#FFFFFF',
      '#C0643C',
      'proposition-and-proof',
      'One product-specific proof object carries the visual identity through the page',
    ),
    variant(
      'independent-studio',
      'Syne',
      'DM Sans',
      '#EFECE6',
      '#FCF9F3',
      '#201E22',
      '#666269',
      '#6745A4',
      '#FFFFFF',
      '#D25C39',
      'asymmetric-story-grid',
      'An asymmetric story grid turns the real subject matter into the brand motif',
    ),
    variant(
      'night-signal',
      'Space Grotesk',
      'IBM Plex Sans',
      '#121622',
      '#202638',
      '#F2F3F8',
      '#B2B8C8',
      '#A7E56B',
      '#10150B',
      '#7D79EE',
      'signal-and-sequence',
      'A single luminous signal connects the promise, proof sequence, and conversion action',
    ),
  ],
} satisfies Record<string, readonly ProfileVariant[]>;

export const DESIGN_ENGINE_V4_REVISION = 2;

function stableVariantIndex(seed: string, count: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % count;
}

/** Rule selection is labeled honestly; there are no fabricated candidate/vision scores. */
export function createDesignEngineV4(
  product: ProductDesignContext,
  projectSeed?: string,
): DesignEngineV4 {
  const key =
    product.productType in profiles ? (product.productType as keyof typeof profiles) : 'saas';
  const variants: readonly ProfileVariant[] = profiles[key];
  const seed = projectSeed ?? product.identitySeed ?? `${product.industry}:${product.primaryGoal}`;
  const selected = variants[stableVariantIndex(seed, variants.length)]!;
  const {
    profile,
    display,
    body,
    background,
    surface,
    foreground,
    muted,
    primary,
    onPrimary,
    accent,
    hero,
    componentStyle,
    signature,
  } = selected;
  const dna = createDesignDNA(product);
  dna.directionId = profile;
  dna.visualDirection = `${profile}: ${product.visualTone.join(', ')}; ${hero}`;
  dna.typography = {
    ...dna.typography,
    display,
    body,
    displayWeight: 600,
    scale: [14, 16, 20, 28, 40, 72],
  };
  dna.colors = {
    ...dna.colors,
    background,
    surface: background,
    surfaceRaised: surface,
    text: foreground,
    muted,
    primary,
    onPrimary,
    warning: accent,
  };
  dna.radius =
    componentStyle === 'soft'
      ? { sm: 12, md: 20, lg: 30, pill: 999 }
      : componentStyle === 'sculpted'
        ? { sm: 18, md: 28, lg: 44, pill: 999 }
        : componentStyle === 'technical'
          ? { sm: 3, md: 6, lg: 10, pill: 999 }
          : { sm: 2, md: 4, lg: 8, pill: 999 };
  dna.buttonStyle = `${componentStyle}; one dominant action and a visibly quieter secondary treatment`;
  dna.cardStyle = `${componentStyle}; vary image-led, editorial and utility groupings by content purpose`;
  dna.navigationStyle = `${componentStyle}; compact intent-led navigation composed with the ${signature}`;
  dna.imageryStyle = `${dna.imageryStyle}. Signature: ${signature}`;
  dna.containerWidths = { content: 720, wide: 1280 };
  const photographic = [
    'restaurant',
    'fitness',
    'fashion',
    'commerce',
    'portfolio',
    'agency',
    'healthcare',
    'local_service',
    'content',
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
    revision: DESIGN_ENGINE_V4_REVISION,
    product,
    dna,
    selection: {
      method: 'curated-rules',
      profile,
      reason: `${product.industry}; ${product.primaryGoal}. Accent ${accent}. User-supplied brand constraints take precedence; never claim this is a measured visual benchmark.`,
      componentStyle,
      signature,
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
    'Use rk-container, rk-section, rk-hero, rk-hero-title, rk-section-title, rk-grid, rk-card, rk-button, rk-button-secondary, rk-site-header, rk-header-inner, rk-site-nav, rk-header-actions, rk-surface-primary and rk-surface-inverse classes. They are plain CSS, not Tailwind plugins. Use data-section-id matching the storyboard.',
    'rk-hero is a two-column layout; give it exactly two direct children: copy/actions and media/demo. Use rk-grid for normal product lists; never use six skinny paragraph cards. Do not add fixed card widths.',
    'Import BrandImage from the provided components/reklu path for every photo and product image. Never render /generated/ sources with raw img or next/image: failed files must use the designed BrandImage fallback, never a browser broken-image icon or visible alt text. Declare requested imagery with literal src="/generated/descriptive-name.png" and detailed literal alt text so the asset service can fulfill it. The alt must name the concrete business subject and exclude plausible distractors: for example cafe exterior with storefront and seating, no cars; coffee hero with cup or barista, no animals. Never invent remote image IDs. Use role="critical" for hero and primary product media. Loading/fallback media is not final completion.',
    'Keep headings concise. Desktop hero 2–4 lines, section 1–3; mobile at most 5. Do not force br tags or one-word lines. Never split a word to make a heading fit: word-break: break-all, overflow-wrap: anywhere, narrow fixed-width title wrappers and skinny fractional hero columns are blocking failures. Never apply viewport-wide type sizes inside a narrow column.',
    'Use CSS variables --color-background, --color-foreground, --color-primary, --color-on-primary, --color-inverse, --color-on-inverse and --color-on-inverse-muted. Use paired colors on every contrast surface. A dark footer must use rk-surface-inverse and its on-inverse tokens. No white text on an unresolved image background.',
    'The site header must be <header className="rk-site-header"><div className="rk-header-inner"><brand/><nav className="rk-site-nav">...</nav><div className="rk-header-actions">...</div></div></header>. Keep it in normal document flow; do not make a marketing header sticky, fixed, translucent or positioned over hero media.',
    `Preserve the selected identity: ${engine.selection.profile}; ${engine.selection.componentStyle}; signature ${engine.selection.signature}. Repeat the signature motif deliberately in two or three sections, but vary section composition. Do not fall back to the usual cream/green/serif restaurant template unless those exact tokens are in this contract.`,
    'Use rk-card for actual cards only. Not every content group is a card: mix editorial rows, image crops, lists, and utility panels according to purpose. Avoid three identical bordered icon cards as the main proof section, repeated rectangular CTA buttons, and oversized empty footer/CTA bands.',
    'Commerce pages must show a credible in-stock preview by default unless the user supplied inventory data. Do not label every item Sold out. Product imagery is a critical asset and cannot be silently omitted.',
    'Use real SVG icons from one installed family, 20–24px, inline with labels; never emoji icons. Reduced motion must preserve visible content.',
    'Preserve familiar navigation, product grids, pricing tables and forms. Distinction comes from brand, composition, content and imagery, not breaking useful grids.',
    'One meaningful first viewport with heading, action and media/demo. No full-height empty sections. First preview is interactive; final quality is a separate evidence-based gate.',
  ].join('\n');
}

/** Plain CSS works independently of Tailwind version/content scanning. */
export function compileDesignStyles(engine: DesignEngineV4): string {
  const { dna } = engine;
  const serif = /Fraunces|Bodoni|Newsreader|Cormorant/.test(dna.typography.display);
  const componentStyle = engine.selection.componentStyle;
  const cardBorder =
    componentStyle === 'technical' || componentStyle === 'editorial'
      ? '1px solid color-mix(in srgb, var(--color-foreground) 20%, transparent)'
      : '1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent)';
  const cardShadow =
    componentStyle === 'sculpted'
      ? '0 24px 70px color-mix(in srgb, var(--color-foreground) 13%, transparent)'
      : componentStyle === 'soft'
        ? '0 14px 40px color-mix(in srgb, var(--color-foreground) 8%, transparent)'
        : 'none';
  const buttonRadius = componentStyle === 'soft' ? dna.radius.pill : dna.radius.sm;
  const buttonTransform =
    componentStyle === 'technical' || componentStyle === 'editorial' ? 'uppercase' : 'none';
  const buttonTracking =
    componentStyle === 'technical' || componentStyle === 'editorial' ? '.06em' : 'normal';
  // Browser-loaded fonts never make preview startup depend on a font download.
  // Only compiler-curated families are requested; arbitrary imported names use fallbacks.
  const knownFonts = new Set<string>([
    ...Object.values(profiles).flatMap((variants) =>
      variants.flatMap((profile) => [profile.display, profile.body]),
    ),
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
  --color-accent: ${dna.colors.warning};
  --color-surface: ${dna.colors.surfaceRaised}; --color-muted-foreground: ${dna.colors.muted};
  --color-inverse: var(--color-foreground); --color-on-inverse: var(--color-background);
  --color-on-inverse-muted: color-mix(in srgb, var(--color-background) 76%, var(--color-foreground));
  --font-display: "${dna.typography.display}", ${serif ? 'Georgia, serif' : 'system-ui, sans-serif'};
  --font-body: "${dna.typography.body}", system-ui, sans-serif;
  --type-hero: clamp(2.5rem, 1.5rem + 3.3vw, 4.5rem);
  --type-h1: var(--type-hero); --type-h2: clamp(2rem, 1.3rem + 1.6vw, 3rem);
  --type-h3: clamp(1.25rem, 1rem + .6vw, 1.5rem); --type-body: 1rem;
  --spacing-section: clamp(3.5rem, 6vw, 6.5rem); --spacing-gutter: clamp(1.25rem, 3vw, 3rem);
  --button-bg: var(--color-primary); --button-fg: var(--color-on-primary);
  --card-padding: clamp(1.25rem, 2.2vw, 2rem); --card-radius: ${dna.radius.md}px;
  --card-border: ${cardBorder}; --card-shadow: ${cardShadow};
  --header-bg: var(--color-background); --footer-bg: var(--color-inverse);
  --footer-fg: var(--color-on-inverse); --footer-muted: var(--color-on-inverse-muted);
}
:where(html,body) { max-width: 100%; overflow-x: clip; }
:where(body) { margin: 0; background: var(--color-background); color: var(--color-foreground); font-family: var(--font-body); font-size: var(--type-body); line-height: 1.6; }
.rk-container, .rk-container *, .rk-button, .rk-media, .rk-site-header * { box-sizing: border-box; }
:where(h1,h2,h3) { font-family: var(--font-display); line-height: 1.1; text-wrap: balance; overflow-wrap: normal; word-break: normal; hyphens: none; }
:where(h1) { font-size: var(--type-h1); }
:where(h2) { font-size: var(--type-h2); }
:where(h3) { font-size: var(--type-h3); }
.rk-container { width: min(calc(100% - 2 * var(--spacing-gutter)), ${engine.layout.container}px); margin-inline: auto; }
.rk-section { padding-block: var(--spacing-section); }
.rk-hero { display: grid !important; grid-template-columns: minmax(24rem, .9fr) minmax(28rem, 1.1fr) !important; gap: clamp(2rem, 5vw, 5rem) !important; align-items: center; padding-block: var(--spacing-section); min-height: auto !important; height: auto !important; }
.rk-hero:not(.rk-container) { width: min(calc(100% - 2 * var(--spacing-gutter)), ${engine.layout.container}px); margin-inline: auto; }
.rk-hero > * { min-width: 0; width: auto !important; max-width: none !important; grid-column: auto !important; }
.rk-hero > :last-child { justify-self: stretch; }
.rk-hero > :last-child.rk-media { width: 100% !important; }
.rk-hero-title { width: auto !important; min-width: 0; max-width: 20ch !important; font-size: var(--type-hero); line-height: 1.04; margin-block: 0 1.5rem; overflow-wrap: normal !important; word-break: normal !important; hyphens: none !important; }
.rk-section-title { font-size: var(--type-h2); max-width: 28ch; margin-block: 0 1.5rem; }
.rk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, ${engine.layout.cardMin}px), 1fr)); gap: 1.5rem; align-items: stretch; }
.rk-grid > * { min-width: 0; }
.rk-card { min-width: 0; padding: var(--card-padding); background: var(--color-surface); border: var(--card-border); border-radius: var(--card-radius); box-shadow: var(--card-shadow); }
.rk-button { display: inline-flex; align-items: center; justify-content: center; gap: .625rem; min-height: 44px; padding: .75rem 1.5rem; background: var(--button-bg); color: var(--button-fg); border: 1px solid transparent; border-radius: ${buttonRadius}px; text-decoration: none; font: inherit; font-weight: 700; text-transform: ${buttonTransform}; letter-spacing: ${buttonTracking}; cursor: pointer; }
.rk-button-secondary { background: transparent; color: var(--color-foreground); border-color: color-mix(in srgb, var(--color-foreground) 42%, transparent); }
.rk-button svg { width: 20px; height: 20px; flex: none; }
.rk-button:hover { filter: brightness(.92); }
.rk-button:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
.rk-button:disabled { opacity: .55; cursor: not-allowed; }
.rk-surface-primary { background: var(--color-primary); color: var(--color-on-primary); }
.rk-surface-inverse { background: var(--footer-bg); color: var(--footer-fg); }
.rk-surface-inverse :where(p,small,li) { color: var(--footer-muted); }
.rk-surface-inverse :where(a,h1,h2,h3,h4,strong) { color: inherit; }
.rk-site-header { position: relative !important; inset: auto !important; z-index: 20; width: 100%; background: var(--header-bg); color: var(--color-foreground); }
.rk-header-inner { width: min(calc(100% - 2 * var(--spacing-gutter)), ${engine.layout.container}px); min-height: 72px; margin-inline: auto; display: grid !important; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: clamp(1rem, 3vw, 3rem); }
.rk-site-nav, .rk-header-actions { display: flex !important; align-items: center; gap: clamp(.75rem, 1.6vw, 1.5rem); min-width: 0; }
.rk-site-nav { justify-content: center; }
.rk-header-actions { justify-content: flex-end; }
.rk-site-header a { color: inherit; text-decoration: none; }
.rk-media { display: grid; overflow: hidden; background: var(--color-surface); color: var(--color-foreground); border-radius: var(--card-radius); }
.rk-media img { width: 100%; height: 100%; min-height: 0; object-fit: cover; }
.rk-media-fallback { padding: 1.5rem; align-self: center; text-align: center; }
@media (max-width: 959px) { .rk-hero { grid-template-columns: minmax(0, 1fr) !important; } .rk-hero-title { max-width: 100% !important; } }
@media (max-width: 767px) { .rk-header-inner { grid-template-columns: minmax(0, 1fr) auto; padding-block: .75rem; } .rk-site-nav { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; overflow-x: auto; padding-bottom: .25rem; } }
@media (prefers-reduced-motion: reduce) { .rk-button { transition: none; } [data-section-id] { scroll-behavior: auto; } }
`;
}
