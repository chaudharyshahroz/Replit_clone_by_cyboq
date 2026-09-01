import type { GeneratedFile } from './parse';

/** Next may create this in its container, but it must exist in the saved tree. */
export function ensureNextRootLayout(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  const paths = new Set(files.map((file) => file.path));
  const appRoot = [...paths].some((path) => /^src\/app\/page\.(?:tsx|jsx|ts|js)$/.test(path))
    ? 'src/app'
    : [...paths].some((path) => /^app\/page\.(?:tsx|jsx|ts|js)$/.test(path))
      ? 'app'
      : undefined;
  if (!appRoot || [...paths].some((path) => new RegExp(`^${appRoot}/layout\\.(?:tsx|jsx|ts|js)$`).test(path))) {
    return files;
  }

  const stylesheet = paths.has(`${appRoot}/globals.css`) ? "import './globals.css';\n\n" : '';
  return [
    ...files,
    {
      path: `${appRoot}/layout.tsx`,
      language: 'tsx',
      content:
        `${stylesheet}export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {\n` +
        `  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`,
    },
  ];
}
