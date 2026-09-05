import type { BuildBrief } from './brief';
import type { GeneratedFile } from './parse';
import { tailwindStylesProblem } from './repair-styles';

export type DesignIssueSeverity = 'blocking' | 'warning';

export interface DesignQualityIssue {
  readonly code: string;
  readonly severity: DesignIssueSeverity;
  readonly message: string;
}

export interface GenericityIssue {
  readonly code: string;
  readonly weight: number;
  readonly message: string;
}

export interface GenericityReport {
  /** 0 is distinctive; 100 is strongly template-like. */
  readonly score: number;
  readonly genericityIssues: readonly GenericityIssue[];
  readonly rejected: boolean;
}

const EMPTY_MARKETING_COPY = [
  /no featured products(?: yet)?/i,
  /no products(?: available| yet)?/i,
  /no testimonials(?: yet)?/i,
  /no reviews(?: yet)?/i,
  /check back soon/i,
  /nothing (?:to show|here)(?: yet)?/i,
];

const GENERIC_COPY = [
  /everything you need to (?:succeed|grow|thrive)/i,
  /unlock your (?:potential|future)/i,
  /take (?:your|the) .{0,30} to the next level/i,
  /transform your (?:body|business|life)/i,
  /why choose us/i,
];

/** Emoji pictographs used as decoration rather than ordinary punctuation. */
const UI_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

const BROWSER_ONLY_STATE = /\b(?:window|document|navigator|localStorage|sessionStorage)\b/;

const DESTRUCTIVE_HEADING_WRAP =
  /(?:h[1-3]|hero[^,{]{0,60}title|headline|display-heading)[^{]{0,120}\{[^}]{0,600}(?:word-break\s*:\s*(?:break-all|break-word)|overflow-wrap\s*:\s*(?:anywhere|break-word))|<h[1-3]\b[^>]{0,500}\b(?:break-all|break-words)\b/i;

const NARROW_HERO_CSS =
  /(?:hero|headline)[^{]{0,100}\{[^}]{0,800}(?:max-)?width\s*:\s*(?:[12]\d{2}px|3[01]\dpx|(?:[1-9]|1[0-8])rem|(?:[1-2]\d|3[0-2])%)\b/i;

const SKINNY_HERO_GRID =
  /(?:hero)[^{]{0,100}\{[^}]{0,800}grid-template-columns\s*:\s*(?:(?:[12]\d|3[0-2])%\s+|(?:0?\.[123]\d*fr)\s+)/i;

function usesDesignEngineV4(files: readonly GeneratedFile[]): boolean {
  return files.some(
    (file) =>
      /(?:^|\/)\.reklu\/design-engine\.json$/.test(file.path) &&
      /["']version["']\s*:\s*4\b/.test(file.content),
  );
}

/** Return call bodies without pretending a regular expression can parse nested JavaScript. */
function hookArguments(content: string, hook: string): readonly string[] {
  const calls: string[] = [];
  const pattern = new RegExp(`(?:React\\.)?${hook}(?:<[^;()]{0,400}>)?\\s*\\(`, 'g');
  for (const match of content.matchAll(pattern)) {
    const open = match.index! + match[0].lastIndexOf('(');
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = open; index < content.length; index += 1) {
      const character = content[index]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) {
        calls.push(content.slice(open + 1, index));
        break;
      }
    }
  }
  return calls;
}

/** Browser-derived initial state is the dominant generated Next hydration failure. */
export function hydrationSafetyIssues(files: readonly GeneratedFile[]): readonly DesignQualityIssue[] {
  const riskyFiles = files.filter(
    (file) =>
      /\.(?:tsx|jsx)$/.test(file.path) &&
      hookArguments(file.content, 'useState').some((argument) => BROWSER_ONLY_STATE.test(argument)),
  );
  const renderConditionFiles = files.filter(
    (file) =>
      /\.(?:tsx|jsx)$/.test(file.path) &&
      /return\s*\([\s\S]{0,1200}?typeof\s+window\s*!==?\s*['"]undefined['"]/.test(file.content),
  );
  const paths = [...new Set([...riskyFiles, ...renderConditionFiles].map((file) => file.path))];
  if (paths.length === 0) return [];
  return [
    {
      code: 'non-deterministic-first-render',
      severity: 'blocking',
      message: `Server and browser can produce different initial markup in ${paths.join(', ')}. Initialize deterministic state and read browser-only values in useEffect after mount.`,
    },
  ];
}

/** Deterministic anti-template gate; fast enough to run before first preview. */
export function evaluateGenericity(files: readonly GeneratedFile[]): GenericityReport {
  const visual = files
    .filter((file) => /\.(?:tsx|jsx|html|css|scss)$/.test(file.path))
    .map((file) => file.content)
    .join('\n');
  const issues: GenericityIssue[] = [];
  const add = (code: string, weight: number, message: string) =>
    issues.push({ code, weight, message });

  if (UI_EMOJI.test(visual)) add('emoji-ui-icon', 25, 'Emoji is used as interface imagery.');
  if (GENERIC_COPY.some((pattern) => pattern.test(visual)))
    add('generic-marketing-copy', 20, 'Interchangeable marketing copy weakens brand identity.');
  // Product/pricing grids deliberately repeat. Counting components is not visual evidence
  // of genericity; composition must be judged at section level in the rendered review.
  if ((visual.match(/<(?:section|div)[^>]*className=["'][^"']*text-center/g) ?? []).length >= 3) {
    add('repeated-centered-sections', 15, 'Centered section composition repeats too often.');
  }
  if ((visual.match(/(?:\b\d+(?:\.\d+)?[KkMm]?\+|99\.9%|100%)/g) ?? []).length >= 2) {
    add(
      'fabricated-vanity-counters',
      25,
      'Multiple unsupported round-number claims resemble template filler.',
    );
  }
  if (
    /bg-gradient-to-|text-transparent\s+bg-clip-text|shadow-[^"'\s]*\[(?:.*(?:purple|violet|blue))/i.test(
      visual,
    )
  ) {
    add(
      'generic-gradient-treatment',
      15,
      'A stock gradient/glow treatment replaces product-specific art direction.',
    );
  }

  const score = Math.min(
    100,
    issues.reduce((total, issue) => total + issue.weight, 0),
  );
  return { score, genericityIssues: issues, rejected: score >= 35 };
}

/** Fast source-level critic that catches failures too obvious to ship to preview. */
export function auditDesignQuality(
  brief: BuildBrief,
  files: readonly GeneratedFile[],
): readonly DesignQualityIssue[] {
  if (brief.target === 'api') return [];

  const visual = files
    .filter((file) => /\.(?:tsx|jsx|html|css|scss)$/.test(file.path))
    .map((file) => file.content)
    .join('\n');
  if (!visual) return [];

  const issues: DesignQualityIssue[] = [];
  issues.push(...hydrationSafetyIssues(files));
  const tailwindProblem = tailwindStylesProblem(files);
  if (tailwindProblem) {
    issues.push({
      code: 'tailwind-not-loaded',
      severity: 'blocking',
      message: tailwindProblem,
    });
  }
  if (!/<h1\b/i.test(visual)) {
    issues.push({
      code: 'missing-primary-heading',
      severity: 'blocking',
      message: 'No primary h1 is present, so the page has no clear opening promise.',
    });
  }

  if (UI_EMOJI.test(visual)) {
    issues.push({
      code: 'emoji-ui-icon',
      severity: 'blocking',
      message:
        'The interface contains emoji pictographs. Replace them with one coherent SVG or installed icon family unless the user explicitly requested emoji styling.',
    });
  }

  if (brief.target === 'website') {
    if (DESTRUCTIVE_HEADING_WRAP.test(visual)) {
      issues.push({
        code: 'destructive-heading-wrap',
        severity: 'blocking',
        message:
          'Heading CSS can split words into unreadable fragments. Remove break-all/anywhere/break-word wrapping from headings and give the copy column enough inline space for whole words.',
      });
    }

    if (NARROW_HERO_CSS.test(visual) || SKINNY_HERO_GRID.test(visual)) {
      issues.push({
        code: 'collapsed-hero-column',
        severity: 'blocking',
        message:
          'The hero copy/title is constrained to a narrow fixed or fractional column. Use the compiler rk-hero grid, keep the copy column at least 24rem on desktop, and collapse to one column below 960px.',
      });
    }

    if (usesDesignEngineV4(files)) {
      const markup = files
        .filter((file) => /\.(?:tsx|jsx|html)$/.test(file.path))
        .map((file) => file.content)
        .join('\n');
      if (!/\brk-hero\b/.test(markup) || !/\brk-hero-title\b/.test(markup)) {
        issues.push({
          code: 'missing-v4-hero-contract',
          severity: 'blocking',
          message:
            'This V4 website does not use both rk-hero and rk-hero-title. Apply the compiler-owned hero contract with exactly two direct children so generated CSS cannot collapse the first viewport.',
        });
      }
    }

    const empty = EMPTY_MARKETING_COPY.find((pattern) => pattern.test(visual));
    if (empty) {
      issues.push({
        code: 'raw-marketing-empty-state',
        severity: 'blocking',
        message:
          'A public marketing section exposes an empty-data message. Replace it with realistic curated preview content or omit the section.',
      });
    }

    if (!/<(?:a|button)\b|<Link\b/.test(visual)) {
      issues.push({
        code: 'missing-primary-action',
        severity: 'blocking',
        message: 'The website has no visible link or button leading to a meaningful next step.',
      });
    }

    const genericCopy = GENERIC_COPY.find((pattern) => pattern.test(visual));
    if (genericCopy) {
      issues.push({
        code: 'generic-marketing-copy',
        severity: 'blocking',
        message:
          'The page uses interchangeable marketing copy. Replace it with concise, credible language specific to this product and audience.',
      });
    }

    const unsupportedCounters = visual.match(/(?:\b\d+(?:\.\d+)?[KkMm]?\+|99\.9%|100%)/g) ?? [];
    if (unsupportedCounters.length >= 2) {
      issues.push({
        code: 'fabricated-vanity-counters',
        severity: 'blocking',
        message:
          'Multiple round-number performance claims appear without evidence. Remove fabricated counters or replace them with specific, supportable proof.',
      });
    }

    const centeredSections =
      visual.match(/<(?:section|div)[^>]*className=["'][^"']*text-center/g) ?? [];
    if (centeredSections.length >= 3) {
      issues.push({
        code: 'repeated-centered-sections',
        severity: 'warning',
        message:
          'Three or more centered compositions repeat the same rhythm. Introduce a subject-appropriate asymmetric, media-led, or editorial section next.',
      });
    }

    const viewportSections =
      visual.match(/(?:min-h-screen|h-screen|min-height\s*:\s*100vh)/g) ?? [];
    if (viewportSections.length > 1) {
      issues.push({
        code: 'repeated-viewport-sections',
        severity: 'warning',
        message:
          'Several sections force a full viewport height. Size sections from their content and use a deliberate spacing scale.',
      });
    }

    if (!/<(?:img|Image)\b|backgroundImage|background-image/.test(visual)) {
      issues.push({
        code: 'no-visual-media',
        severity: 'warning',
        message: 'The marketing experience contains no visible photographic or editorial media.',
      });
    }
  }

  return issues;
}

export function designFeedbackPrompt(issues: readonly DesignQualityIssue[]): string {
  if (issues.length === 0) return '';
  return [
    '',
    'Design critic findings — resolve every blocking issue and address warnings without changing behavior:',
    ...issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`),
  ].join('\n');
}
