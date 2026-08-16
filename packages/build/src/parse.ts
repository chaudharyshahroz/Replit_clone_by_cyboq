/**
 * Parsing generated code out of a model response.
 *
 * Models emit file trees in several shapes depending on provider and prompt.
 * This accepts the common ones rather than demanding a single format, because a
 * strict parser that rejects a whole generation over one malformed fence throws
 * away work the user already paid for.
 *
 * Every path is validated before it becomes a file — a generated path is
 * attacker-influenced input (spec §36, packages/sandbox/src/paths.ts).
 */
import { assertSafeRelativePath, SandboxError } from '@reklu/sandbox';

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
  readonly language: string;
}

export interface ParseResult {
  readonly files: readonly GeneratedFile[];
  /** Paths the model emitted that were rejected, with the reason. */
  readonly rejected: readonly { path: string; reason: string }[];
  /** Prose outside any file block — usually the model's explanation. */
  readonly commentary: string;
}

/** Map a fence language hint to a stable language id for the editor. */
function normalizeLanguage(hint: string, path: string): string {
  const fromHint = hint.trim().toLowerCase();
  if (fromHint && fromHint !== 'text') return fromHint;

  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const byExtension: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
sql: 'sql',
  };
  return byExtension[extension] ?? 'text';
}

/**
 * Extract files from a model response.
 *
 * Recognised shapes, in order of preference:
 *
 *   1. A path comment immediately before a fence:
 *        `// src/app/page.tsx`  then  ```tsx … ```
 *   2. A fence whose info string carries the path:
 *        ```tsx src/app/page.tsx
 *   3. A markdown heading naming the file, then a fence:
 *        `### src/app/page.tsx`
 */
export function parseGeneratedFiles(response: string): ParseResult {
  const files: GeneratedFile[] = [];
  const rejected: { path: string; reason: string }[] = [];
  const commentaryParts: string[] = [];

  // Match fences along with whatever line preceded them.
  const pattern = /(^|\n)([^\n]*)\n```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(response)) !== null) {
    const precedingLine = (match[2] ?? '').trim();
    const infoString = (match[3] ?? '').trim();
    const content = match[4] ?? '';

    commentaryParts.push(response.slice(lastIndex, match.index));
    lastIndex = pattern.lastIndex;

    const path = extractPath(precedingLine, infoString);
    if (!path) {
      // A fence with no path is illustrative code, not a file.
      continue;
    }

    try {
      const safePath = assertSafeRelativePath(path);
      files.push({
        path: safePath,
        content: content.replace(/\n+$/, ''),
        language: normalizeLanguage(infoString.split(/\s+/)[0] ?? '', safePath),
      });
    } catch (error) {
      // Recorded, not silently dropped: the user should know a file was
      // refused and why.
      rejected.push({
        path,
        reason: error instanceof SandboxError ? error.message : 'Invalid path',
      });
    }
  }

  commentaryParts.push(response.slice(lastIndex));

  return {
    files: deduplicateByPath(files),
    rejected,
    commentary: commentaryParts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/** A path looks like `dir/file.ext` — has a separator or an extension. */
function looksLikePath(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 200) return false;
  if (/\s/.test(candidate)) return false;
  return candidate.includes('/') || /\.[a-z0-9]{1,10}$/i.test(candidate);
}

function extractPath(precedingLine: string, infoString: string): string | undefined {
  // 2. Path in the fence info string: ```tsx src/app/page.tsx
  const infoParts = infoString.split(/\s+/).filter(Boolean);
  if (infoParts.length > 1) {
    const candidate = stripDecoration(infoParts.slice(1).join(' '));
    if (looksLikePath(candidate)) return candidate;
  }

  // 1 & 3. Path on the preceding line, as a comment, heading, or bare path.
  const cleaned = stripDecoration(precedingLine);
  if (looksLikePath(cleaned)) return cleaned;

  return undefined;
}

/** Remove comment markers, headings, bold, backticks and trailing colons. */
function stripDecoration(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(\/\/|#|<!--)\s*/, '')
    .replace(/-->$/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^`|`$/g, '')
    .replace(/^(?:File|Path):\s*/i, '')
    .replace(/:$/, '')
    .trim();
}

/**
 * Later definitions win.
 *
 * A model that revises a file within one response means the last version, and
 * keeping both would write the stale one second.
 */
function deduplicateByPath(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const byPath = new Map<string, GeneratedFile>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()];
}
