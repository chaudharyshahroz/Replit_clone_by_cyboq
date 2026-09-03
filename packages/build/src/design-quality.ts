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

/** Deterministic anti-template gate; fast enough to run before first preview. */
export function evaluateGenericity(files: readonly GeneratedFile[]): GenericityReport {
  const visual = files
    .filter((file) => /\.(?:tsx|jsx|html|css|scss)$/.test(file.path))
    .map((file) => file.content)
    .join('\n');
  const issues: GenericityIssue[] = [];
  const add = (code: string, weight: number, message: string) => issues.push({ code, weight, message });

  if (UI_EMOJI.test(visual)) add('emoji-ui-icon', 25, 'Emoji is used as interface imagery.');
  if (GENERIC_COPY.some((pattern) => pattern.test(visual))) add('generic-marketing-copy', 20, 'Interchangeable marketing copy weakens brand identity.');
  if ((visual.match(/(?:<Card\b|className=["'][^"']*\bcard\b)/g) ?? []).length >= 4) {
    add('repeated-card-grid', 30, 'Four or more card components create a repeated template rhythm.');
  }
  if ((visual.match(/<(?:section|div)[^>]*className=["'][^"']*text-center/g) ?? []).length >= 3) {
    add('repeated-centered-sections', 15, 'Centered section composition repeats too often.');
  }
  if ((visual.match(/(?:\b\d+(?:\.\d+)?[KkMm]?\+|99\.9%|100%)/g) ?? []).length >= 2) {
    add('fabricated-vanity-counters', 25, 'Multiple unsupported round-number claims resemble template filler.');
  }
  if (/bg-gradient-to-|text-transparent\s+bg-clip-text|shadow-[^"'\s]*\[(?:.*(?:purple|violet|blue))/i.test(visual)) {
    add('generic-gradient-treatment', 15, 'A stock gradient/glow treatment replaces product-specific art direction.');
  }

  const score = Math.min(100, issues.reduce((total, issue) => total + issue.weight, 0));
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

    const cardReferences = visual.match(/(?:<Card\b|className=["'][^"']*\bcard\b)/g) ?? [];
    if (cardReferences.length >= 4) {
      issues.push({
        code: 'repeated-card-grid',
        severity: 'blocking',
        message:
          'Four or more card-shaped components make the narrative look template-driven. Redesign the affected sequence with varied editorial, media, split, rail, or full-bleed compositions.',
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

    const centeredSections = visual.match(/<(?:section|div)[^>]*className=["'][^"']*text-center/g) ?? [];
    if (centeredSections.length >= 3) {
      issues.push({
        code: 'repeated-centered-sections',
        severity: 'warning',
        message:
          'Three or more centered compositions repeat the same rhythm. Introduce a subject-appropriate asymmetric, media-led, or editorial section next.',
      });
    }

    const viewportSections = visual.match(/(?:min-h-screen|h-screen|min-height\s*:\s*100vh)/g) ?? [];
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
