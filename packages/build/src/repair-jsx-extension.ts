import type { GeneratedFile } from './parse';

/** JSX is invalid in .ts/.js files even though extensionless imports look correct. */
export function repairJsxExtensions(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const paths = new Set(files.map((file) => file.path));

  return files.map((file) => {
    const extension = file.path.endsWith('.ts') ? '.ts' : file.path.endsWith('.js') ? '.js' : null;
    if (!extension || file.path.endsWith('.d.ts')) return file;

    /* A closing tag or a common host opening tag is strong JSX evidence and
     * avoids mistaking TypeScript comparison/generic syntax for markup. */
    const containsJsx = /<\/[A-Za-z][\w.-]*\s*>|<(?:svg|path|div|span|section|main|header|footer|nav|button|a|img|form|input)(?:\s|\/?>)/.test(
      file.content,
    );
    if (!containsJsx) return file;

    const replacement = `${file.path.slice(0, -extension.length)}${extension}x`;
    if (paths.has(replacement)) return file;
    return { ...file, path: replacement, language: extension === '.ts' ? 'typescriptreact' : 'javascriptreact' };
  });
}
