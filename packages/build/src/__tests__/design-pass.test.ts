/**
 * The visual pass.
 *
 * A second model call with one job: keep the behaviour, raise the design. Its
 * risks are the opposite of generation's — a pass that quietly drops a feature,
 * or invents a route nothing links to, damages a working application in the
 * name of making it prettier.
 */
import { describe, expect, it } from 'vitest';
import { needsDesignPass, visualFiles } from '../design-pass';
import type { GeneratedFile } from '../parse';

const file = (path: string, language = 'tsx'): GeneratedFile => ({
  path,
  content: 'x',
  language,
});

describe('when a design pass runs', () => {
  it('runs where what it looks like is what it is', () => {
    for (const target of ['website', 'web_app', 'dashboard', 'mobile_app'] as const) {
      expect(needsDesignPass(target), target).toBe(true);
    }
  });

  /*
   * An API has no visual design to improve. Spending a model call pretending
   * otherwise costs the user money and returns nothing.
   */
  it('does not run for a service with no interface', () => {
    expect(needsDesignPass('api')).toBe(false);
  });
});

describe('what the pass is shown', () => {
  it('includes the files that decide how it looks', () => {
    const chosen = visualFiles([
      file('app/page.tsx'),
      file('app/globals.css', 'css'),
      file('tailwind.config.ts', 'ts'),
      file('components/Hero.tsx'),
    ]).map((entry) => entry.path);

    expect(chosen).toContain('app/page.tsx');
    expect(chosen).toContain('app/globals.css');
    expect(chosen).toContain('tailwind.config.ts');
    expect(chosen).toContain('components/Hero.tsx');
  });

  /*
   * Sending these would spend the context window on files whose appearance is
   * not in question, leaving less room for the ones that are.
   */
  it('leaves out files with nothing visual in them', () => {
    const chosen = visualFiles([
      file('package.json', 'json'),
      file('README.md', 'md'),
      file('lib/db.ts', 'ts'),
      file('app/page.tsx'),
    ]).map((entry) => entry.path);

    expect(chosen).toEqual(['app/page.tsx']);
  });

  /* Installed and built output is not the project's design. */
  it('never sends dependencies or build output', () => {
    const chosen = visualFiles([
      file('node_modules/react/index.js', 'js'),
      file('.next/static/chunk.css', 'css'),
      file('dist/bundle.css', 'css'),
      file('app/page.tsx'),
    ]).map((entry) => entry.path);

    expect(chosen).toEqual(['app/page.tsx']);
  });

  it('sends nothing for a project with no interface', () => {
    expect(visualFiles([file('src/server.ts', 'ts'), file('package.json', 'json')])).toEqual([]);
  });
});
