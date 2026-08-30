/**
 * Which design, for this product.
 *
 * The visual guidance Reklu already gives is sound and entirely general: pick a
 * type scale, use one accent, space on a scale. A model reading it still has to
 * invent every specific — which blue, which two typefaces, which weights — and
 * inventing is where generated pages go wrong. They come back Inter on white
 * with a purple gradient, because that is the average of everything.
 *
 * This narrows the decision to a catalogue. A coffee shop resolves to a product
 * type with a palette whose contrast has been checked, a style with the CSS
 * that implements it, and a font pairing with the exact Google Fonts URL — the
 * weights in that URL are ones the families really publish, which is the single
 * most common way a generated page has failed to build here.
 *
 * The data is from ui-ux-pro-max-skill (MIT); see vendor/ui-ux-pro-max.
 *
 * What this deliberately does not do is decide how the page looks. It supplies
 * the materials; the rules in build-skills.ts still govern execution, and where
 * the two disagree — the catalogue's most common landing pattern is a hero and
 * three feature cards, which is exactly what Reklu tells the model not to
 * produce — the prompt says which one wins.
 */
import type { BuildBrief, BuildTarget } from './brief';
import {
  CHART_CHOICES,
  FONT_PAIRINGS,
  LANDING_PATTERNS,
  PRODUCT_PROFILES,
  STYLE_PROFILES,
  UX_RULES,
  type ChartChoice,
  type FontPairing,
  type LandingPattern,
  type ProductProfile,
  type StyleProfile,
  type UxRule,
} from './design-data';

export interface DesignDirection {
  readonly product: ProductProfile;
  readonly style: StyleProfile | undefined;
  readonly fonts: FontPairing | undefined;
  readonly landing: LandingPattern | undefined;
  readonly rules: readonly UxRule[];
  readonly charts: readonly ChartChoice[];
  /**
   * Whether the product type was recognised or fallen back to.
   *
   * Surfaced rather than hidden: a build that matched nothing has been given a
   * sensible default, not a considered one, and the build log should say so.
   */
  readonly matched: boolean;
  readonly matchScore: number;
}

/** Lowercased, punctuation flattened, space-padded so `includes` is word-safe. */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Everything about the product worth matching on.
 *
 * The stack is left out on purpose. "Next.js" says nothing about whether this
 * is a bakery or a bank, and including it made every React brief drift toward
 * the developer-tool palettes.
 */
function briefText(brief: BuildBrief): string {
  /*
   * Every list is treated as possibly absent. The schema gives them defaults,
   * but a brief is persisted as JSON and read back later — one written before a
   * field existed has no such default, and spreading undefined throws inside
   * generation, where the failure looks like the model went wrong.
   */
  const pages = brief.pages ?? [];

  const words = normalise(
    [
      brief.product,
      brief.summary,
      ...(brief.coreFeatures ?? []),
      ...pages.map((page) => `${page.name} ${page.purpose}`),
      ...(brief.integrations ?? []),
    ].join(' '),
  )
    .split(' ')
    .filter((word) => word && !DELIVERABLE_WORDS.has(word));

  /* Synonyms are added, never substituted: the original word may match too. */
  const expanded = [...words];
  for (const word of words) {
    const corrected = correct(word);
    if (corrected) expanded.push(corrected);

    const synonym = SYNONYMS[corrected ?? word];
    if (synonym) expanded.push(...synonym.split(/[^a-z0-9]+/).filter(Boolean));
  }

  return ` ${expanded.join(' ')} `;
}

/**
 * Words that describe the deliverable rather than the subject.
 *
 * These are ignored when matching, and the reason is a failure that shipped:
 * "landing" and "page" appear in exactly one of the 192 product types, so the
 * frequency weighting below gave them the *highest* score available — and a
 * brief opening "let's build a landing page for my coffee shop" resolved to
 * Link-in-Bio Page Builder. Rare in the catalogue, ubiquitous in briefs, is the
 * one combination the weighting gets backwards.
 *
 * They are safe to drop because the brief's `target` already carries what kind
 * of thing is being built. This list is only about what it is *for*.
 */
const DELIVERABLE_WORDS = new Set([
  'landing',
  'page',
  'pages',
  'site',
  'website',
  'web',
  'homepage',
  'section',
  'sections',
  'build',
  'design',
  'full',
  'complete',
  'modern',
  'responsive',
  'beautiful',
  'business',
  'company',
  'custom',
  'online',
]);

/**
 * Brief vocabulary the catalogue does not carry.
 *
 * Some rows have thin keyword lists — Bakery/Cafe has exactly two, `bakery` and
 * `cafe` — so an ordinary way of naming that business misses it entirely. These
 * map words people actually write onto words the catalogue indexes.
 *
 * Kept deliberately short. Every entry is a word that appeared in a real brief
 * and matched nothing; guessing at more would be inventing a thesaurus and
 * would make the matching harder to reason about, not better.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  coffee: 'cafe',
  coffeeshop: 'cafe',
  espresso: 'cafe',
  patisserie: 'bakery',
  bistro: 'restaurant',
  salon: 'beauty',
  barbershop: 'beauty',
  gym: 'fitness',
  clinic: 'healthcare',
  dentist: 'healthcare',
  dental: 'healthcare',
  store: 'shop',
};

/**
 * Every word the catalogue can be matched on.
 *
 * Used to forgive a typo: a brief that says "coffe shop" carries the subject in
 * the one word that is misspelt, and matched nothing at all. The user's own
 * first build failed this way.
 */
const VOCABULARY = new Set<string>([
  ...PRODUCT_PROFILES.flatMap((profile) => profile.keywords),
  ...Object.keys(SYNONYMS),
]);

/**
 * Whether two words are one edit apart.
 *
 * Bounded at one on purpose. Two edits starts matching words that are simply
 * different — `shop` and `stop`, `cafe` and `case` — and a confidently wrong
 * palette is worse than no match at all. Short words are not checked for the
 * same reason: at four characters, one edit is most of the word.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    /* Same length means a substitution; different means an insertion. */
    if (shorter.length === longer.length) i += 1;
    j += 1;
  }

  return edits + (longer.length - j) + (shorter.length - i) <= 1;
}

/** The vocabulary word a misspelt one probably meant, if there is exactly one. */
function correct(word: string): string | undefined {
  if (word.length < 5 || VOCABULARY.has(word)) return undefined;

  let found: string | undefined;
  for (const candidate of VOCABULARY) {
    if (!withinOneEdit(word, candidate)) continue;
    /* Ambiguous between two vocabulary words is not a correction, it is a guess. */
    if (found) return undefined;
    found = candidate;
  }
  return found;
}

/**
 * How much a keyword hit is worth.
 *
 * A word shared by fifty product types separates nothing — "app" matches a
 * bakery as readily as a bank — so a keyword's weight falls with the number of
 * profiles carrying it. Without this, generic words dominate and almost
 * everything resolves to the general SaaS profile.
 */
function keywordWeights(): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const profile of PRODUCT_PROFILES) {
    for (const keyword of profile.keywords) {
      frequency.set(keyword, (frequency.get(keyword) ?? 0) + 1);
    }
  }

  const weights = new Map<string, number>();
  for (const [keyword, count] of frequency) {
    weights.set(keyword, 1 / Math.log2(count + 1));
  }
  return weights;
}

const WEIGHTS = keywordWeights();

/**
 * The score below which a match is treated as no match.
 *
 * Calibrated by measuring real briefs with the threshold off, not picked. At
 * 1.5 the cut falls between the wrong answers and the right ones: a barber shop
 * scored 1.06 against Gift & Wishlist and a record store 1.00 against Password
 * Manager — both on a single stray word — while a dental clinic scored 1.50
 * against Healthcare App, which is correct. A real subject scores 3 or more;
 * the type's own name alone is worth 4.
 */
const MINIMUM_SCORE = 1.5;

/** The product types Reklu falls back to when a brief matches nothing. */
const FALLBACK_TYPE: Readonly<Record<BuildTarget, string>> = {
  website: 'Marketing Agency',
  web_app: 'SaaS (General)',
  dashboard: 'Analytics Dashboard',
  mobile_app: 'Productivity Tool',
  api: 'API Developer Portal',
};

function profileScore(profile: ProductProfile, text: string): number {
  let score = 0;
  for (const keyword of profile.keywords) {
    if (text.includes(` ${keyword} `)) score += WEIGHTS.get(keyword) ?? 0.5;
  }

  /*
   * The type's own name, which the keywords do not always repeat.
   *
   * "Analytics Dashboard" lists only its specific vocabulary — kpi, cohort,
   * attribution — while "Smart Home/IoT Dashboard" happens to list the plain
   * words `analytics` and `dashboard`. A brief that says "analytics dashboard"
   * in as many words therefore matched the smart-home palette. Naming the
   * thing you are building is the strongest signal available, so it outweighs
   * any single keyword.
   */
  for (const part of profile.type.split('/')) {
    const name = normalise(part).trim();
    if (name.length > 3 && text.includes(` ${name} `)) score += 4;
  }

  return score;
}

/** The catalogue entry closest to this brief, and how close it was. */
export function matchProduct(brief: BuildBrief): { profile: ProductProfile; score: number } {
  const text = briefText(brief);

  let best: ProductProfile | undefined;
  let bestScore = 0;

  for (const profile of PRODUCT_PROFILES) {
    const score = profileScore(profile, text);
    /*
     * Strictly greater, so ties keep the earlier row. The catalogue is ordered
     * general to niche, and a tie between "SaaS (General)" and something exotic
     * should not be settled by which happens to be later in the file.
     */
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }

  /*
   * A weak match is not a match.
   *
   * One generic word scoring alone — "online", "shop" — is noise, and acting on
   * it hands the build a confident palette chosen for the wrong kind of
   * product. Below the threshold the target's default is used, and the build
   * log says the direction was a default rather than a decision.
   */
  if (best && bestScore >= MINIMUM_SCORE) return { profile: best, score: bestScore };

  const fallbackName = FALLBACK_TYPE[brief.target];
  const fallback =
    PRODUCT_PROFILES.find((profile) => profile.type === fallbackName) ?? PRODUCT_PROFILES[0];
  return { profile: fallback as ProductProfile, score: 0 };
}

/**
 * Resolve a style name from the product catalogue to a style profile.
 *
 * The two tables do not share a vocabulary: products name "Minimalism", styles
 * call it "Minimalism & Swiss Style", and a compound like "Glassmorphism + Flat
 * Design" names two. Exact lookup found nothing for eleven product types, which
 * would have quietly dropped the style guidance for those builds rather than
 * failing anywhere visible.
 */
export function matchStyle(name: string): StyleProfile | undefined {
  const parts = name
    .split(/[+,/]/)
    .map((part) => part.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);

  for (const part of parts) {
    const needle = part.toLowerCase();
    const exact = STYLE_PROFILES.find((style) => style.name.toLowerCase() === needle);
    if (exact) return exact;

    const prefixed = STYLE_PROFILES.find((style) => style.name.toLowerCase().startsWith(needle));
    if (prefixed) return prefixed;

    const contained = STYLE_PROFILES.find((style) => style.name.toLowerCase().includes(needle));
    if (contained) return contained;
  }

  return undefined;
}

/**
 * The landing pattern for a product's recommendation.
 *
 * Matched on keywords rather than name: seventy-one of the product profiles
 * describe their pattern ("Conversion-Optimized + Demo") instead of naming one,
 * so name lookup would have failed for most of the catalogue.
 */
export function matchLanding(description: string): LandingPattern | undefined {
  const text = normalise(description);

  let best: LandingPattern | undefined;
  let bestScore = 0;

  for (const pattern of LANDING_PATTERNS) {
    let score = text.includes(normalise(pattern.name).trim()) ? pattern.name.length : 0;
    for (const keyword of pattern.keywords) {
      if (text.includes(` ${keyword} `)) score += keyword.length;
    }
    if (score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }

  return best;
}

/** The font pairing whose mood and intended use best fit this brief. */
export function matchFonts(brief: BuildBrief, profile: ProductProfile): FontPairing | undefined {
  const text = `${briefText(brief)}${normalise(profile.type)}${normalise(profile.paletteFocus)}`;

  let best: FontPairing | undefined;
  let bestScore = 0;

  for (const pairing of FONT_PAIRINGS) {
    let score = 0;
    for (const mood of pairing.mood) {
      if (text.includes(` ${mood} `)) score += 2;
    }
    for (const use of pairing.bestFor.toLowerCase().split(/[,;]/)) {
      const term = use.trim();
      if (term.length > 3 && text.includes(` ${normalise(term).trim()} `)) score += 3;
    }
    if (score > bestScore) {
      best = pairing;
      bestScore = score;
    }
  }

  /*
   * A pairing is always returned. Its job is to keep the model off Inter-on-
   * white and to give it a URL whose weights exist; the first entry does both
   * even when nothing in the brief matched.
   */
  return best ?? FONT_PAIRINGS[0];
}

/**
 * Targets where what it looks like is part of what it is.
 *
 * A background API has no pages to put a palette on. Sending it one costs a
 * thousand tokens of the generation's attention and tells it something untrue
 * about what it is building.
 */
const VISUAL_TARGETS: readonly BuildTarget[] = ['website', 'web_app', 'dashboard', 'mobile_app'];

export function isVisualTarget(target: BuildTarget): boolean {
  return VISUAL_TARGETS.includes(target);
}

/** Platforms whose rules apply to a target. */
function platformsFor(target: BuildTarget): readonly string[] {
  return target === 'mobile_app' ? ['All', 'Mobile'] : ['All', 'Web'];
}

/** Everything the generator should be told about how this product should look. */
export function chooseDirection(brief: BuildBrief): DesignDirection {
  const { profile, score } = matchProduct(brief);

  const styleName =
    brief.target === 'dashboard' && profile.dashboardStyle && profile.dashboardStyle !== 'N/A'
      ? profile.dashboardStyle
      : profile.primaryStyle;

  const platforms = platformsFor(brief.target);

  return {
    product: profile,
    style: matchStyle(styleName) ?? matchStyle(profile.primaryStyle),
    fonts: matchFonts(brief, profile),
    /* Only a page someone lands on has a landing pattern. */
    landing: brief.target === 'website' ? matchLanding(profile.landingPattern) : undefined,
    rules: UX_RULES.filter((rule) => platforms.includes(rule.platform)),
    charts: brief.target === 'dashboard' ? CHART_CHOICES : [],
    matched: score > 0,
    matchScore: score,
  };
}

/** `--token: #hex;` lines for the palette, ready to paste into a stylesheet. */
function paletteBlock(direction: DesignDirection): string {
  const { palette } = direction.product;
  return [
    `  --color-primary: ${palette.primary};      --color-on-primary: ${palette.onPrimary};`,
    `  --color-secondary: ${palette.secondary};    --color-on-secondary: ${palette.onSecondary};`,
    `  --color-accent: ${palette.accent};       --color-on-accent: ${palette.onAccent};`,
    `  --color-background: ${palette.background};   --color-foreground: ${palette.foreground};`,
    `  --color-card: ${palette.card};         --color-card-foreground: ${palette.cardForeground};`,
    `  --color-muted: ${palette.muted};        --color-muted-foreground: ${palette.mutedForeground};`,
    `  --color-border: ${palette.border};       --color-ring: ${palette.ring};`,
    `  --color-destructive: ${palette.destructive};  --color-on-destructive: ${palette.onDestructive};`,
  ].join('\n');
}

/**
 * The direction as prompt text.
 *
 * Written as materials and constraints rather than as a description of a
 * finished page. Told "here is the palette, here is the type pairing, here are
 * the rules", a model designs; handed a picture of a page, it transcribes one.
 */
export function directionPrompt(direction: DesignDirection, target: BuildTarget): string {
  const { product, style, fonts, landing } = direction;

  const lines: string[] = [
    '',
    'Design direction for this build:',
    '',
    `Product type: ${product.type}${direction.matched ? '' : ' (closest available match)'}`,
    `Consider: ${product.considerations}`,
    '',
    'Palette — use these exact values as CSS custom properties. Contrast has',
    'already been checked against WCAG; do not substitute your own colours.',
    `Rationale: ${product.palette.notes}`,
    '',
    ':root {',
    paletteBlock(direction),
    '}',
    '',
    'The accent is for the primary action and nothing else. An accent on every',
    'card is the same as no accent.',
  ];

  if (fonts) {
    lines.push(
      '',
      `Typefaces: ${fonts.heading} for display, ${fonts.body} for text — ${fonts.name}.`,
      `Load with exactly this URL, and no other weights:`,
      fonts.googleFontsUrl,
      `Why: ${fonts.notes}`,
      'The weights in that URL are ones these families actually publish. Adding a',
      'weight that does not exist is the most common way a generated page fails.',
      'Always give a real fallback stack after the loaded family.',
    );
  }

  if (style) {
    lines.push(
      '',
      `Visual style: ${style.name}.`,
      `Implement it with: ${style.cssKeywords}`,
      `Motion and effects: ${style.effects}`,
      `Tokens this style expects: ${style.tokens}`,
      `Checklist: ${style.checklist}`,
    );

    if (/⚠|Low/.test(style.accessibility)) {
      lines.push(
        `Accessibility caveat for this style: ${style.accessibility}. Where the style`,
        'and legibility disagree, legibility wins — keep body text above 4.5:1.',
      );
    }
  }

  if (landing) {
    lines.push(
      '',
      `Page structure: ${landing.name}.`,
      `Sections, in order: ${landing.sectionOrder}`,
      `Primary call to action: ${landing.ctaPlacement}`,
      `Colour across sections: ${landing.colorStrategy}`,
      '',
      'That order is the information architecture — which sections exist and what',
      'each is for. It is not a layout. Give the sections different shapes: vary',
      'the column count, alternate contained and full-bleed, and do not render',
      'every feature as an equal card in a row of three.',
    );
  }

  if (direction.charts.length > 0) {
    lines.push(
      '',
      'Choosing a chart — match the shape of the data, not the look of the chart:',
      ...direction.charts
        .slice(0, 12)
        .map((choice) => `- ${choice.dataType}: ${choice.chart}. Not when: ${choice.whenNotTo}`),
    );
  }

  if (direction.rules.length > 0) {
    lines.push(
      '',
      `Rules that fail a review (${target === 'mobile_app' ? 'mobile' : 'web'}):`,
      ...direction.rules.map((rule) => `- ${rule.issue}: ${rule.doThis}. Never: ${rule.notThis}`),
    );
  }

  return lines.join('\n');
}

/** A one-line summary for the build log, so a reader can see what was chosen. */
export function describeDirection(direction: DesignDirection): string {
  const parts = [
    direction.product.type,
    direction.style?.name,
    direction.fonts ? `${direction.fonts.heading}/${direction.fonts.body}` : undefined,
    direction.landing?.name,
  ].filter(Boolean);

  return `${parts.join(' · ')}${direction.matched ? '' : ' (default — nothing in the brief matched)'}`;
}

export type { ChartChoice, FontPairing, LandingPattern, ProductProfile, StyleProfile, UxRule };
