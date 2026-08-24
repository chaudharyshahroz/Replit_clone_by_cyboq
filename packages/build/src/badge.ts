/**
 * The "Made with Reklu" mark on a generated site.
 *
 * Added to the file tree rather than injected while serving, so it is part of
 * the application the way anything else is: visible in the code view, present
 * in a GitHub export, and removable by asking for it to be removed. A mark that
 * only appeared in the preview would be a claim about the deployed site that
 * was not true of it.
 *
 * Written as plain inline styles with no imports, because it has to survive in
 * a project whose styling conventions are unknown — a class name would depend
 * on a stylesheet that may not define it, and a component import would depend on
 * a path alias that may not resolve.
 */
import type { GeneratedFile } from './parse';

/** Layout files a badge could be attached to, in the order they are preferred. */
const LAYOUTS = ['app/layout.tsx', 'src/app/layout.tsx', 'app/layout.jsx', 'src/app/layout.jsx'];

const MARKER = 'data-reklu-badge';

/** The badge markup, as JSX. */
export const BADGE_JSX = [
  '        <a',
  `          ${MARKER}="true"`,
  '          href="https://reklu.app"',
  '          target="_blank"',
  '          rel="noopener noreferrer"',
  '          style={{',
  "            position: 'fixed',",
  "            right: '16px',",
  "            bottom: '16px',",
  "            zIndex: 2147483000,",
  "            display: 'inline-flex',",
  "            alignItems: 'center',",
  "            gap: '6px',",
  "            padding: '7px 12px',",
  "            borderRadius: '999px',",
  "            border: '1px solid rgba(255,255,255,0.14)',",
  "            background: 'rgba(17,17,19,0.82)',",
  "            backdropFilter: 'blur(8px)',",
  "            color: 'rgba(255,255,255,0.92)',",
  "            font: '500 12px/1 ui-sans-serif, system-ui, sans-serif',",
  "            textDecoration: 'none',",
  '          }}',
  '        >',
  '          Made with Reklu',
  '        </a>',
].join('\n');

/**
 * Attach the badge to a generated application.
 *
 * Only where there is exactly one obvious place to put it. A layout without a
 * closing body tag is one this does not understand, and guessing at a position
 * inside a file it cannot read properly would damage a working application to
 * add a mark to it.
 */
export function addMadeWithBadge(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const layoutPath = LAYOUTS.find((candidate) =>
    files.some((file) => file.path === candidate),
  );
  if (!layoutPath) return files;

  return files.map((file) => {
    if (file.path !== layoutPath) return file;

    /* Already there — an edit must not stack a second badge on every pass. */
    if (file.content.includes(MARKER)) return file;

    const closing = file.content.lastIndexOf('</body>');
    if (closing === -1) return file;

    const before = file.content.slice(0, closing);
    const after = file.content.slice(closing);

    return { ...file, content: `${before}${BADGE_JSX}\n      ${after}` };
  });
}
