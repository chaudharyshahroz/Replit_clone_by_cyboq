/**
 * `output: 'export'` on an app that cannot be static.
 *
 * Next reports the collision at the very end of the build, as "Export
 * encountered errors on following paths" listing `/404`, `/500` and `/` — the
 * pages every application has. It reads as the whole site being broken rather
 * than as one line in a config file, which is why it is worth correcting
 * mechanically instead of leaving to whoever reads the log.
 */
import { describe, expect, it } from 'vitest';
import { needsServer, repairStaticExport } from '../repair-export';
import type { GeneratedFile } from '../parse';

const config = (body: string): GeneratedFile => ({
  path: 'next.config.js',
  language: 'javascript',
  content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n${body}\n};\nmodule.exports = nextConfig;`,
});

const route: GeneratedFile = {
  path: 'app/api/services/route.ts',
  language: 'typescript',
  content: 'export async function GET() { return Response.json([]); }',
};

describe('deciding whether an app needs a server', () => {
  it('sees a route handler', () => {
    expect(needsServer([route])).toBe('app/api/services/route.ts');
  });

  it('sees one under src/, and a pages API route, and middleware', () => {
    for (const path of ['src/app/api/x/route.ts', 'pages/api/x.ts', 'src/middleware.ts']) {
      expect(needsServer([{ ...route, path }])).toBe(path);
    }
  });

  it('sees redirects and headers in the config', () => {
    // Evaluated by a server on the way to a page; a static export has none.
    expect(needsServer([config('  async redirects() { return []; },')])).toContain('redirects');
    expect(needsServer([config('  async headers() { return []; },')])).toContain('headers');
  });

  it('says nothing about a site that really is static', () => {
    const page: GeneratedFile = { path: 'app/page.tsx', language: 'tsx', content: 'export default () => null;' };
    expect(needsServer([page, config("  output: 'export',")])).toBeUndefined();
  });
});

describe('repairing the config', () => {
  it('removes the setting when the app has a route handler', () => {
    const [, repaired] = repairStaticExport([route, config("  output: 'export',")]);

    expect(repaired?.content).not.toContain("output: 'export'");
    // And says why, in the file, for whoever reads it later.
    expect(repaired?.content).toContain('Removed by Reklu');
    expect(repaired?.content).toContain('app/api/services/route.ts');
  });

  it('handles either quoting', () => {
    const [, repaired] = repairStaticExport([route, config('  output: "export",')]);
    expect(repaired?.content).not.toContain('output: "export"');
  });

  it('leaves a genuinely static site exactly as it is', () => {
    /*
     * A static export is the right answer for a page of text, and removing it
     * would turn a site that needs no server into one that does.
     */
    const page: GeneratedFile = { path: 'app/page.tsx', language: 'tsx', content: 'export default () => null;' };
    const files = [page, config("  output: 'export',")];

    expect(repairStaticExport(files)).toBe(files);
  });

  it('leaves other settings alone', () => {
    const [, repaired] = repairStaticExport([
      route,
      config("  output: 'export',\n  reactStrictMode: true,"),
    ]);

    expect(repaired?.content).toContain('reactStrictMode: true');
  });

  it('is unchanged on a config that never had it', () => {
    const files = [route, config('  reactStrictMode: true,')];
    expect(repairStaticExport(files)[1]).toBe(files[1]);
  });
});
