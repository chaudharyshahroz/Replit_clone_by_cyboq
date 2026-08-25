/**
 * Publishing, and the parts of it that are expensive to get wrong.
 *
 * A domain is not a field on a form. Claiming the wrong one hands somebody a
 * hostname Reklu itself answers on; routing one before its DNS arrives makes
 * the proxy ask a certificate authority for a name that does not point here,
 * and enough of those failures rate-limits certificate renewal for every name
 * on the account — including the ones that were working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@reklu/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@reklu/shared');
  return {
    ...actual,
    loadServerEnv: () => ({
      PUBLISH_DOMAIN: 'sites.reklu.app',
      SANDBOX_PREVIEW_DOMAIN: 'previews.reklu.app',
      PUBLISH_SERVER_IP: '203.0.113.10',
      APP_URL: 'https://reklu.app',
    }),
  };
});

const { dnsInstructions, hostsFor, normalizeDomain, productionCommand, publicUrl } = await import(
  '../publish'
);

beforeEach(() => vi.clearAllMocks());

describe('reading a domain somebody typed', () => {
  it('accepts a domain however it was pasted', () => {
    expect(normalizeDomain('  HTTPS://Shop.Example.com/  ')).toEqual({ domain: 'shop.example.com' });
  });

  it('refuses a URL with a path', () => {
    /*
     * Discarding the path quietly would publish to a hostname the person did
     * not think they were giving.
     */
    expect(normalizeDomain('example.com/shop')).toEqual({
      error: 'Enter just the domain, without a path.',
    });
  });

  it('refuses things that are not domains', () => {
    for (const input of ['localhost', 'not a domain', 'example', '.com']) {
      expect(normalizeDomain(input)).toHaveProperty('error');
    }
  });

  it("refuses names inside Reklu's own domains", () => {
    /*
     * A site claiming one of these gets a router rule for a hostname Reklu
     * already answers on, and which one wins comes down to start order.
     */
    for (const input of ['sites.reklu.app', 'x.sites.reklu.app', 'reklu.app', 'a.previews.reklu.app']) {
      expect(normalizeDomain(input)).toHaveProperty('error');
    }
  });
});

describe('which hostnames a site answers on', () => {
  const base = { slug: 'cut-and-craft', customDomain: null, domainStatus: 'none' as const };

  it('always keeps its Reklu address', () => {
    expect(hostsFor(base)).toEqual(['cut-and-craft.sites.reklu.app']);
  });

  it('does not route a domain that has not been verified', () => {
    // Routing it early is what gets certificate issuance rate-limited.
    expect(hostsFor({ ...base, customDomain: 'example.com', domainStatus: 'pending' })).toEqual([
      'cut-and-craft.sites.reklu.app',
    ]);
  });

  it('serves the apex and its www together once verified', () => {
    /*
     * Someone typing the address with the prefix is not asking for a different
     * website, and a certificate covering one of them makes the other a
     * browser warning.
     */
    const hosts = hostsFor({ ...base, customDomain: 'example.com', domainStatus: 'live' });

    expect(hosts).toContain('example.com');
    expect(hosts).toContain('www.example.com');
    // And the old link keeps working.
    expect(hosts).toContain('cut-and-craft.sites.reklu.app');
  });

  it('does not double the prefix on a domain that already has one', () => {
    const hosts = hostsFor({ ...base, customDomain: 'www.example.com', domainStatus: 'live' });

    expect(hosts).toContain('www.example.com');
    expect(hosts).toContain('example.com');
    expect(hosts).not.toContain('www.www.example.com');
  });
});

describe('the address shown to its owner', () => {
  it('is the custom domain once it works, and the Reklu one until then', () => {
    const base = { slug: 'shop', customDomain: 'example.com' };

    expect(publicUrl({ ...base, domainStatus: 'live' })).toBe('https://example.com');
    expect(publicUrl({ ...base, domainStatus: 'pending' })).toBe('https://shop.sites.reklu.app');
  });
});

describe('what to tell a registrar', () => {
  it('gives an apex an A record', () => {
    /*
     * Most DNS providers cannot put a CNAME at a zone root — the standard
     * forbids one alongside the SOA and NS records every zone carries.
     */
    expect(dnsInstructions('example.com', 'shop')).toEqual({
      type: 'A',
      name: '@',
      value: '203.0.113.10',
    });
  });

  it('points a subdomain at the site, not at its own parent', () => {
    expect(dnsInstructions('shop.example.com', 'cut-and-craft')).toEqual({
      type: 'CNAME',
      name: 'shop',
      value: 'cut-and-craft.sites.reklu.app',
    });
  });
});

describe('how a published site is served', () => {
  it('runs the start script when the framework has a server', () => {
    const command = productionCommand({ scripts: { build: 'next build', start: 'next start' } });

    expect(command.command).toBe('npm');
    expect(command.args).toEqual(['run', 'start']);
    expect(command.env['NODE_ENV']).toBe('production');
  });

  it('serves static output when the build produced files rather than a server', () => {
    // A Vite site builds to a directory and has nothing to start.
    const command = productionCommand({ scripts: { build: 'vite build' } });

    expect(command.args).toContain('dist');
    expect(command.args.join(' ')).not.toContain('run start');
  });
});

/**
 * The corrections a publish applies to what it builds.
 *
 * Repairs run when files are written, so a project generated before a given
 * repair existed never receives it. For publishing that is the case that
 * matters: `output: 'export'` on an app with route handlers fails only when
 * every page is rendered ahead of time — something a dev server never does and
 * a production build always does. Without this the project would have to be
 * regenerated to become publishable, which is a strange thing to require of a
 * build that already works.
 */
describe('what a publish builds', () => {
  it('applies the same corrections a generation would', async () => {
    const { repairStaticExport } = await import('../repair-export');

    const tree = [
      {
        path: 'app/api/menu/route.ts',
        language: 'typescript',
        content: 'export async function GET() { return Response.json([]); }',
      },
      {
        path: 'next.config.js',
        language: 'javascript',
        content: "const nextConfig = {\n  output: 'export',\n};\nmodule.exports = nextConfig;",
      },
    ];

    const built = repairStaticExport(tree);
    const config = built.find((file) => file.path === 'next.config.js');

    expect(config?.content).not.toContain("output: 'export'");
    // The route handler is untouched: it is not what is wrong.
    expect(built.find((file) => file.path === 'app/api/menu/route.ts')?.content).toBe(
      tree[0]!.content,
    );
  });
});
