/**
 * Remove a `metadata` export from a component that cannot have one.
 *
 * Next refuses a file that is both marked `"use client"` and exports
 * `metadata`, and it refuses it at compile time with a wall of red in the
 * preview. The mistake is an easy one to make and a model makes it constantly:
 * the page needs a title, so it exports metadata; the page needs a dropdown, so
 * it adds `"use client"`. Each line is right on its own.
 *
 * The correction is mechanical because only one of the two can stay, and only
 * one of them is load-bearing. Without the directive the interactive parts of
 * the page throw at runtime; without the export the page renders and loses its
 * title. A page that works and is missing a `<title>` beats a page that does
 * not compile, so the export goes and says why it went.
 *
 * The real fix is for the model not to write it, which is a build-skill rule.
 * This is the safety net for when it does anyway.
 */
import type { GeneratedFile } from './parse';

/** `"use client"` as the first meaningful line, single or double quoted. */
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\s)*['"]use client['"]/;

/**
 * An exported `metadata` or `generateMetadata`, and everything it spans.
 *
 * Matched to the end of its declaration rather than to a line, because a
 * metadata object is written across several — and removing only the first line
 * leaves a dangling object literal, which fails to compile for a new reason.
 */
const METADATA_CONST = /^export\s+const\s+metadata(?:\s*:\s*[A-Za-z<>[\]|\s.]+)?\s*=\s*\{[\s\S]*?^\};?\s*$/m;
const METADATA_FUNCTION = /^export\s+(?:async\s+)?function\s+generateMetadata\s*\([\s\S]*?^\}\s*$/m;

const NOTE =
  '// Removed by Reklu: a component marked "use client" cannot export metadata.\n' +
  '// Move it to a server component — this page keeps working without it.\n';

export function repairClientMetadata(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  return files.map((file) => {
    if (!/\.(tsx|jsx)$/.test(file.path)) return file;
    if (!USE_CLIENT.test(file.content)) return file;

    let content = file.content;
    for (const pattern of [METADATA_CONST, METADATA_FUNCTION]) {
      if (pattern.test(content)) content = content.replace(pattern, NOTE.trimEnd());
    }

    if (content === file.content) return file;

    /*
     * The `Metadata` type import goes too when nothing is left using it. An
     * unused import is not an error, but `next lint` treats it as one under the
     * default config, and the build script runs the linter.
     */
    if (!/\bMetadata\b/.test(content.replace(/^import[^\n]*\n/gm, ''))) {
      content = content.replace(/^import\s+type\s*\{\s*Metadata\s*\}\s*from\s*['"]next['"];?\s*\n/m, '');
    }

    return { ...file, content };
  });
}

const CLIENT_BEHAVIOUR =
  /\b(?:useState|useEffect|useLayoutEffect|useReducer|useRef|useContext)\s*\(|\b(?:window|document|localStorage|sessionStorage)\b|\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|Pointer|Mouse|Touch)\s*=/;

/**
 * Keep static SVG registries out of the React Client Manifest.
 *
 * Next cannot address members of an object exported by a client module as
 * individual client references (`Icons.Mail`, `Icons.YouTube`). An AI model
 * commonly marks a pure icon file as client code even though SVG functions do
 * not need a browser. Removing that unnecessary boundary makes the registry a
 * normal shared module and fixes both server and client consumers.
 */
export function repairClientIconRegistries(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  return files.map((file) => {
    if (!/(?:^|\/)icons?\.(?:tsx|jsx)$/.test(file.path)) return file;
    if (!USE_CLIENT.test(file.content)) return file;
    if (!/export\s+const\s+Icons\s*=\s*\{/.test(file.content)) return file;
    if (CLIENT_BEHAVIOUR.test(file.content)) return file;

    const content = file.content.replace(
      /(^|\n)\s*['"]use client['"];?\s*(?:\n|$)/,
      '$1',
    );
    return content === file.content ? file : { ...file, content };
  });
}
