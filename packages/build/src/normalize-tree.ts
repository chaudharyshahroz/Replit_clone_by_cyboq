import type { GeneratedFile } from './parse';
import { repairPrismaSchemas } from './repair-prisma';
import { repairAliasPaths } from './repair-imports';
import {
  repairMissingDependencies,
  repairUnavailableDependencyVersions,
} from './repair-deps';
import { repairFontWeights } from './repair-fonts';
import { repairStaticExport } from './repair-export';
import { repairClientMetadata } from './repair-client-metadata';
import { repairGlobalStyles } from './repair-styles';
import { repairJsxExtensions } from './repair-jsx-extension';
import { ensureNextRootLayout } from './repair-next-layout';

/** One repair pipeline for newly generated files and historical saved projects. */
export function normalizeGeneratedTree(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  return ensureNextRootLayout(repairJsxExtensions(
    repairGlobalStyles(
      repairClientMetadata(
        repairStaticExport(
          repairFontWeights(
            repairUnavailableDependencyVersions(
              repairMissingDependencies(repairAliasPaths(repairPrismaSchemas(files))),
            ),
          ),
        ),
      ),
    ),
  ));
}
