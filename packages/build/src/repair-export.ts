/**
 * Remove a static export setting from an application that cannot be one.
 *
 * `output: 'export'` turns a Next.js build into a static site: every page is
 * rendered once at build time and written out as HTML. A model reaches for it
 * because it sounds like the safe, simple choice, and for a page of text it is.
 *
 * It is also incompatible with most of what the same model has just written.
 * Route handlers, `next/image`'s default loader, headers, redirects, middleware
 * and anything reading a request are all *server* features, and a static export
 * has no server. Next reports the collision at the very end of the build as
 * "Export encountered errors on following paths", listing `/404`, `/500` and
 * `/` — the pages every application has — which reads as the whole site being
 * broken rather than as one line in a config file.
 *
 * The correction is mechanical: an application with server features is not a
 * static export, and the setting is the thing that is wrong.
 */
import type { GeneratedFile } from './parse';

const CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];

/** `output: 'export'`, however it was quoted or spaced. */
const STATIC_OUTPUT = /^\s*output\s*:\s*(['"])export\1\s*,?\s*$/gm;

/** Things that need a server at request time, and so rule a static export out. */
export function needsServer(files: readonly GeneratedFile[]): string | undefined {
  for (const file of files) {
    /* A route handler is a server endpoint; a static export cannot serve one. */
    if (/^(src\/)?app\/.*route\.(t|j)sx?$/.test(file.path)) return file.path;
    if (/^(src\/)?pages\/api\//.test(file.path)) return file.path;
    if (/^(src\/)?middleware\.(t|j)s$/.test(file.path)) return file.path;
  }

  for (const file of files) {
    if (!CONFIGS.includes(file.path)) continue;
    /*
     * Rewrites, redirects and headers are all evaluated by a server on the way
     * to a page. Declared next to `output: 'export'`, they are silently ignored
     * at best and fail the build at worst.
     */
    const server = /async\s+(headers|redirects|rewrites)\s*\(/.exec(file.content);
    if (server) return `${file.path} (${server[1]})`;
  }

  return undefined;
}

export function repairStaticExport(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const reason = needsServer(files);
  if (!reason) return files;

  return files.map((file) => {
    if (!CONFIGS.includes(file.path)) return file;
    if (!STATIC_OUTPUT.test(file.content)) {
      STATIC_OUTPUT.lastIndex = 0;
      return file;
    }
    STATIC_OUTPUT.lastIndex = 0;

    const repaired = file.content.replace(
      STATIC_OUTPUT,
      `  // Removed by Reklu: this app has server features (${reason}), which a\n` +
        `  // static export cannot serve.\n`,
    );

    return repaired === file.content ? file : { ...file, content: repaired };
  });
}
