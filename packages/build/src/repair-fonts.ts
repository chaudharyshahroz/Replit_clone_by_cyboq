/**
 * Fix font weights `next/font` will not accept.
 *
 * A variable font's range is written `100..900` in CSS, and a model reaches for
 * that spelling naturally. `next/font/google` does not take a range: it takes
 * discrete weights or the literal `variable`, and anything else fails the build
 * with "Unknown weight" — which the reader meets as a page that will not
 * compile, in a file they did not write.
 *
 * A range means exactly one thing — this is a variable font — so the correction
 * is mechanical and needs nobody's judgement.
 */
import type { GeneratedFile } from './parse';

/** A CSS variable-font range in a quoted string: '100..900'. */
const RANGE = /(['"])\d{2,3}\.\.\d{2,3}\1/g;

export function repairFontWeights(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  return files.map((file) => {
    if (!/\.(tsx?|jsx?)$/.test(file.path)) return file;

    /*
     * Only where the font loader is actually used. The same characters in an
     * unrelated string are not a font weight, and rewriting them would be
     * editing code on the strength of a coincidence.
     */
    if (!file.content.includes('next/font')) return file;

    let repaired = file.content.replace(RANGE, (_match, quote: string) =>
      `${quote}variable${quote}`,
    );
    // Google Fonts URL notation combines weight and style (400italic).
    // next/font expects separate weight and style options. Restrict this
    // rewrite to calls of loaders actually imported from next/font/google.
    for (const imported of file.content.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/g)) {
      for (const entry of imported[1]!.split(',')) {
        const name = entry.trim().split(/\s+as\s+/).pop();
        if (!name || !/^\w+$/.test(name)) continue;
        const call = new RegExp(`\\b${name}\\(\\s*\\{([^{}]*)\\}\\s*\\)`, 'g');
        repaired = repaired.replace(call, (whole, options: string) => {
          const weight = /\bweight\s*:\s*(\[[^\]]*\]|['"][^'"]*['"])/.exec(options);
          if (!weight || !/['"]\d{3}italic['"]/.test(weight[1]!)) return whole;
          const normal = /['"]\d{3}['"]/.test(weight[1]!);
          let updated = options.replace(weight[0], weight[0].replace(/(['"])(\d{3})italic\1/g, '$1$2$1'));
          if (!/\bstyle\s*:/.test(options)) {
            updated = `style: ${normal ? '["normal", "italic"]' : '"italic"'}, ${updated}`;
          }
          return whole.replace(options, updated);
        });
      }
    }

    return repaired === file.content ? file : { ...file, content: repaired };
  });
}
