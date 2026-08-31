import type { BuildBrief } from './brief';
import type { GeneratedFile } from './parse';

export type DesignIssueSeverity = 'blocking' | 'warning';

export interface DesignQualityIssue {
  readonly code: string;
  readonly severity: DesignIssueSeverity;
  readonly message: string;
}

const EMPTY_MARKETING_COPY = [
  /no featured products(?: yet)?/i,
  /no products(?: available| yet)?/i,
  /no testimonials(?: yet)?/i,
  /no reviews(?: yet)?/i,
  /check back soon/i,
  /nothing (?:to show|here)(?: yet)?/i,
];

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
  if (!/<h1\b/i.test(visual)) {
    issues.push({
      code: 'missing-primary-heading',
      severity: 'blocking',
      message: 'No primary h1 is present, so the page has no clear opening promise.',
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
