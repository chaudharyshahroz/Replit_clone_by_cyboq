/**
 * Both themes, defined completely.
 *
 * The classic way a theme breaks is a colour declared in one place and not the
 * other: everything looks right until somebody switches, and then one surface
 * keeps the value from the theme it was written in — dark text on a dark
 * ground, or a border that vanishes. Nothing errors, and it is only found by
 * looking.
 *
 * So the rule is that the two blocks define the same names. What each name
 * means is a design decision; that both exist is not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Resolved from the working directory rather than from `import.meta.url`: these
 * tests run under jsdom, where that is not a file URL and `readFileSync` will
 * not take it.
 */
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

function tokensIn(selector: string): string[] {
  const start = css.indexOf(selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open, close);

  return [...block.matchAll(/^\s*(--[a-z-]+):/gm)].map((match) => match[1]!).sort();
}

const dark = tokensIn(':root {');
const light = tokensIn("[data-theme='light'] {");

describe('the two themes', () => {
  it('define the same tokens', () => {
    expect(light).toEqual(dark);
  });

  it('define enough to be a theme at all', () => {
    /* A guard against the selectors moving and both lists becoming empty. */
    expect(dark.length).toBeGreaterThan(10);
  });

  it('give light four distinct surface steps', () => {
    /*
     * `surface` and `surface-raised` were both pure white, which flattened
     * every component that distinguishes them: a raised panel sat invisibly on
     * the panel it was raised above, and the selected item in a group looked
     * unselected.
     */
    const values = (selector: string) => {
      const start = css.indexOf(selector);
      const block = css.slice(css.indexOf('{', start), css.indexOf('}', css.indexOf('{', start)));
      return ['--canvas', '--surface', '--surface-raised', '--surface-hover'].map(
        (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim(),
      );
    };

    for (const selector of [':root {', "[data-theme='light'] {"]) {
      const surfaces = values(selector);
      expect(surfaces.every(Boolean), selector).toBe(true);
      expect(new Set(surfaces).size, `${selector} has duplicate surfaces`).toBe(4);
    }
  });

  it('sets color-scheme in both, so form controls follow', () => {
    // Without it a native select or scrollbar stays the browser default and
    // reads as the opposite theme.
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/\[data-theme='light'\]\s*\{[^}]*color-scheme:\s*light/);
  });
});
