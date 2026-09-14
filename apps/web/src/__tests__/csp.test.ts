/**
 * The Content-Security-Policy Reklu serves.
 *
 * A CSP failure is silent by construction: the browser refuses something and
 * the page shows a blank rectangle. The build preview was blocked this way —
 * `frame-src` did not list the preview domain, so the frame was refused before
 * the preview was even requested, and Chrome said only "this content is
 * blocked". The preview itself was fine; the page doing the framing was not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../next.config';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

async function cspFor(
  previewDomain?: string,
  nodeEnv: 'production' | 'development' = 'production',
): Promise<string> {
  if (previewDomain) process.env.SANDBOX_PREVIEW_DOMAIN = previewDomain;
  else delete process.env.SANDBOX_PREVIEW_DOMAIN;
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;

  const headers = await config.headers!();
  const global = headers.find((entry) => entry.source === '/(.*)') ?? headers.at(-1)!;
  const csp = global.headers.find((header) => header.key === 'Content-Security-Policy');

  return csp?.value ?? '';
}

afterEach(() => {
  delete process.env.SANDBOX_PREVIEW_DOMAIN;
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('framing build previews', () => {
  it('permits the preview domain when one is configured', async () => {
    const csp = await cspFor('preview.reklu.app');
    expect(csp).toContain('https://*.preview.reklu.app');
  });

  /* Each sandbox gets its own name, so there is no fixed host to permit. */
  it('permits it as a wildcard over that one subdomain', async () => {
    const csp = await cspFor('preview.reklu.app');
    const frameSrc = csp.split(';').find((part) => part.includes('frame-src')) ?? '';

    expect(frameSrc).toContain('*.preview.reklu.app');
    // Not the whole apex: reklu.app itself must not become frameable this way.
    expect(frameSrc).not.toContain(' https://*.reklu.app');
  });

  it('permits nothing extra when previews have no domain', async () => {
    const csp = await cspFor();
    const frameSrc = csp.split(';').find((part) => part.includes('frame-src')) ?? '';

    expect(frameSrc.trim()).toBe("frame-src 'self' https://whop.com https://js.whop.com");
  });
});

describe('the rest of the policy', () => {
  /* The one that matters most: an injected string must not become code. */
  it('never grants unsafe-eval in production', async () => {
    expect(await cspFor('preview.reklu.app', 'production')).not.toContain('unsafe-eval');
  });

  it('grants unsafe-eval to the development server, where React needs it', async () => {
    /*
     * React's development build calls eval() to rebuild call stacks, so
     * without this every page in `next dev` opened on an error overlay.
     */
    const scriptSrc =
      (await cspFor(undefined, 'development')).split(';').find((part) => part.includes('script-src')) ?? '';
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it('grants it only to scripts, never anywhere else', async () => {
    const csp = await cspFor(undefined, 'development');
    const others = csp.split(';').filter((part) => !part.includes('script-src'));
    expect(others.join(';')).not.toContain('unsafe-eval');
  });

  it('keeps scripts to Reklu and Whop', async () => {
    const csp = await cspFor('preview.reklu.app');
    const scriptSrc = csp.split(';').find((part) => part.includes('script-src')) ?? '';

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain('https://js.whop.com');
    expect(scriptSrc).not.toContain('preview.reklu.app');
  });

  /* Reklu itself stays unframeable, whatever previews are allowed to do. */
  it('still refuses to be framed by anyone', async () => {
    expect(await cspFor('preview.reklu.app')).toContain("frame-ancestors 'none'");
  });

  it('still forbids posting a form off-origin', async () => {
    expect(await cspFor('preview.reklu.app')).toContain("form-action 'self'");
  });
});
