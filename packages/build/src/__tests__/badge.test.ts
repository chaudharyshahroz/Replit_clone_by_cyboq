/**
 * The mark on a generated site.
 *
 * The risk is not that it fails to appear — it is that adding it damages a
 * working application. Every case here is about refusing to act on a file this
 * does not understand.
 */
import { describe, expect, it } from 'vitest';
import { addMadeWithBadge } from '../badge';
import type { GeneratedFile } from '../parse';

const layout = (content: string): GeneratedFile => ({
  path: 'app/layout.tsx',
  content,
  language: 'tsx',
});

const WHOLE = `export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
`;

describe('adding the badge', () => {
  it('places it inside the body, at the end', () => {
    const [file] = addMadeWithBadge([layout(WHOLE)]);
    const content = file!.content;

    expect(content).toContain('Made with Reklu');
    expect(content.indexOf('Made with Reklu')).toBeLessThan(content.indexOf('</body>'));
    expect(content.indexOf('{children}')).toBeLessThan(content.indexOf('Made with Reklu'));
  });

  it('links to Reklu and opens away from the page', () => {
    const [file] = addMadeWithBadge([layout(WHOLE)]);
    expect(file!.content).toContain('https://reklu.app');
    expect(file!.content).toContain('rel="noopener noreferrer"');
  });

  /* An edit runs this again; a second badge every time would be a bug. */
  it('does not add a second one on a later pass', () => {
    const once = addMadeWithBadge([layout(WHOLE)]);
    const twice = addMadeWithBadge(once);

    const occurrences = twice[0]!.content.split('Made with Reklu').length - 1;
    expect(occurrences).toBe(1);
  });

  it('leaves every other file untouched', () => {
    const hero: GeneratedFile = { path: 'components/Hero.tsx', content: 'x', language: 'tsx' };
    const result = addMadeWithBadge([layout(WHOLE), hero]);

    expect(result.find((file) => file.path === 'components/Hero.tsx')).toEqual(hero);
  });
});

describe('refusing to guess', () => {
  /*
   * A layout this cannot read properly is one to leave alone. Damaging a
   * working application to add a mark to it is the worst possible trade.
   */
  it('does nothing when the layout has no body tag', () => {
    const odd = layout('export default function L({ children }) { return children; }');
    expect(addMadeWithBadge([odd])).toEqual([odd]);
  });

  it('does nothing when there is no layout at all', () => {
    const files: GeneratedFile[] = [
      { path: 'index.html', content: '<html><body></body></html>', language: 'html' },
    ];
    expect(addMadeWithBadge(files)).toEqual(files);
  });

  it('finds the layout under src as well', () => {
    const files = [{ ...layout(WHOLE), path: 'src/app/layout.tsx' }];
    expect(addMadeWithBadge(files)[0]!.content).toContain('Made with Reklu');
  });

  /* Nested bodies are unusual; the last one is the document's own. */
  it('attaches to the final closing body tag', () => {
    const [file] = addMadeWithBadge([layout(WHOLE)]);
    const content = file!.content;
    expect(content.lastIndexOf('Made with Reklu')).toBeLessThan(content.lastIndexOf('</body>'));
  });
});
