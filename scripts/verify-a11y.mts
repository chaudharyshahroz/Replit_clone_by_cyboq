/**
 * Accessibility checks (spec §111, §150).
 *
 * Runs axe against the HTML the server actually sends, parsed into jsdom.
 *
 * **What this does not cover, stated plainly:** jsdom does no layout and
 * applies no stylesheet, so colour-contrast, focus-visibility and
 * target-size rules cannot run here. Those need a real browser. What it does
 * cover is the structural majority — labels, names, roles, heading order,
 * landmarks, duplicate ids, and ARIA validity — which is where most real
 * defects live and where they are cheapest to fix.
 *
 *   pnpm verify:a11y
 *   VERIFY_ORIGIN=https://reklu.app pnpm verify:a11y
 */
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

const origin = (process.env.VERIFY_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Pages reachable without a session — the only ones this can render. */
const PAGES = ['/', '/login', '/signup'];

let failures = 0;

console.log(`\nChecking ${origin}\n`);

for (const path of PAGES) {
  console.log(`${path}`);

  let html: string;
  try {
    const response = await fetch(`${origin}${path}`);
    if (!response.ok) {
      console.log(`  SKIP  responded ${response.status}`);
      continue;
    }
    html = await response.text();
  } catch (error) {
    console.error(
      `  Could not reach ${origin}${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('  Start the app, or set VERIFY_ORIGIN to a running deployment.\n');
    process.exit(1);
  }

  const dom = new JSDOM(html, { url: `${origin}${path}`, pretendToBeVisual: true });
  const { window } = dom;

  // axe expects browser globals.
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).Node = window.Node;
  (globalThis as Record<string, unknown>).Element = window.Element;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;
  (globalThis as Record<string, unknown>).getComputedStyle = window.getComputedStyle.bind(window);

  const results = await axe.run(window.document.documentElement, {
    // Rules that need real layout would report noise rather than defects.
    rules: {
      'color-contrast': { enabled: false },
      'target-size': { enabled: false },
    },
    resultTypes: ['violations'],
  });

  if (results.violations.length === 0) {
    console.log('  PASS  no violations\n');
    continue;
  }

  for (const violation of results.violations) {
    // serious and critical are defects; minor ones are usually advisory and
    // would drown the signal.
    const blocking = violation.impact === 'serious' || violation.impact === 'critical';
    if (blocking) failures++;

    console.log(
      `  ${blocking ? 'FAIL' : 'WARN'}  ${violation.id} (${violation.impact}) — ${violation.help}`,
    );
    for (const node of violation.nodes.slice(0, 3)) {
      console.log(`        ${node.html.slice(0, 110)}`);
    }
  }
  console.log('');

  window.close();
}

console.log(
  failures === 0
    ? 'No serious or critical violations.\n'
    : `${failures} serious/critical violation(s).\n`,
);
console.log('Note: colour contrast and focus visibility need a real browser and were not checked.\n');
process.exit(failures === 0 ? 0 : 1);
