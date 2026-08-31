import type { GeneratedFile } from './parse';
import { parseManifest } from './dev-command';

const NEXT_HOME = /^(?:src\/)?(?:app\/page|pages\/index)\.(?:tsx|jsx|ts|js)$/;
const EXPO_HOME = /^(?:(?:src\/)?app\/index|App)\.(?:tsx|jsx|ts|js)$/;

function dependencyNames(files: readonly GeneratedFile[]): Set<string> {
  const manifest = parseManifest(files.find((file) => file.path === 'package.json')?.content);
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

/**
 * Name the missing file that would otherwise become a healthy server serving
 * only a framework 404 page. Unknown/custom servers are deliberately left
 * alone: their valid entry point is defined by their own start script.
 */
export function previewEntryProblem(files: readonly GeneratedFile[]): string | undefined {
  const paths = new Set(files.map((file) => file.path));
  const dependencies = dependencyNames(files);

  if (dependencies.has('next') && !files.some((file) => NEXT_HOME.test(file.path))) {
    return 'The Next.js application has no homepage. Add src/app/page.tsx (or app/page.tsx) with a default page component.';
  }

  if (dependencies.has('vite') && !paths.has('index.html')) {
    return 'The Vite application has no index.html entry page.';
  }

  if (dependencies.has('expo') && !files.some((file) => EXPO_HOME.test(file.path))) {
    return 'The Expo application has no web entry page. Add app/index.tsx or App.tsx.';
  }

  return undefined;
}

export interface PreviewHealthCheck {
  readonly path: string;
  /** Visual frameworks need a real rendered page; APIs only need to answer. */
  readonly requireOk: boolean;
}

/** The request used to prove that the generated application, not merely its process, responds. */
export function previewHealthCheck(files: readonly GeneratedFile[]): PreviewHealthCheck {
  const dependencies = dependencyNames(files);
  const visualFramework =
    dependencies.has('next') || dependencies.has('vite') || dependencies.has('expo');
  return { path: '/', requireOk: visualFramework };
}
