import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRepository, pushFiles, toRepositoryName } from '../deploy/github';
import { createDeployment, toProjectName } from '../deploy/vercel';
import { createProject } from '../deploy/supabase';
import { githubProvider } from '../providers/github';
import { IntegrationError } from '../types';

/**
 * These adapters are exercised against a stubbed `fetch` rather than a live
 * provider. That verifies the part Reklu owns — request shape, ordering, and
 * what is *not* sent — without inventing a passing result for an API call that
 * never happened.
 */
interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | undefined;
  /** Token endpoints are form-encoded, not JSON. */
  readonly rawBody: string | undefined;
}

function stubFetch(routes: Array<[RegExp, unknown, number?]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const raw = init?.body ? String(init.body) : undefined;
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    } catch {
      parsed = undefined; // form-encoded, not JSON
    }
    calls.push({ url: href, method: init?.method ?? 'GET', body: parsed, rawBody: raw });

    for (const [pattern, payload, status] of routes) {
      if (pattern.test(href)) {
        return new Response(payload === null ? '' : JSON.stringify(payload), {
          status: status ?? (payload === null ? 404 : 200),
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 500 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('repository naming', () => {
  it.each([
    ['My Great App!', 'my-great-app'],
    ['  spaces  everywhere  ', 'spaces-everywhere'],
    ['Ünïcödé Ápp', 'unicode-app'],
    ['---leading-and-trailing---', 'leading-and-trailing'],
    ['a//////b', 'a-b'],
  ])('normalises %s', (input, expected) => {
    expect(toRepositoryName(input)).toBe(expected);
  });

  // Names GitHub would reject outright must still yield something pushable.
  it('falls back rather than producing an empty name', () => {
    expect(toRepositoryName('!!!')).toBe('reklu-app');
    expect(toRepositoryName('')).toBe('reklu-app');
  });

  it('respects the length limit', () => {
    expect(toRepositoryName('x'.repeat(300))).toHaveLength(100);
  });
});

describe('createRepository', () => {
  it('creates a private, uninitialised repository', async () => {
    const calls = stubFetch([
      [
        /\/user\/repos/,
        { name: 'my-app', default_branch: 'main', html_url: 'https://github.com/me/my-app', owner: { login: 'me' } },
      ],
    ]);

    const target = await createRepository('tok', { name: 'My App' });

    expect(target).toEqual({
      owner: 'me',
      repo: 'my-app',
      branch: 'main',
      htmlUrl: 'https://github.com/me/my-app',
    });
    // Private by default: a generated app belongs to the user, not the world.
    expect(calls[0]?.body?.private).toBe(true);
    // auto_init would force the first push to merge against a README.
    expect(calls[0]?.body?.auto_init).toBe(false);
  });
});

describe('pushFiles', () => {
  const target = {
    owner: 'me',
    repo: 'my-app',
    branch: 'main',
    htmlUrl: 'https://github.com/me/my-app',
  };
  const files = [
    { path: 'package.json', content: '{"name":"x"}' },
    { path: 'src/App.tsx', content: 'export default () => <p>hi</p>;' },
  ];

  it('pushes a whole tree as one commit on an empty repository', async () => {
    const calls = stubFetch([
      [/\/git\/ref\/heads\/main/, null], // no ref yet
      [/\/git\/blobs/, { sha: 'blob-sha' }],
      [/\/git\/trees/, { sha: 'tree-sha' }],
      [/\/git\/commits/, { sha: 'commit-sha' }],
      [/\/git\/refs$/, { ref: 'refs/heads/main' }],
    ]);

    const result = await pushFiles('tok', target, files, 'Initial commit');

    expect(result.commitSha).toBe('commit-sha');
    expect(result.fileCount).toBe(2);

    // A first commit has no parent; sending one would fail against an empty repo.
    const commit = calls.find((call) => call.url.includes('/git/commits'));
    expect(commit?.body?.parents).toEqual([]);

    // The ref is created, not patched, when none exists.
    const refCall = calls.find((call) => call.url.endsWith('/git/refs'));
    expect(refCall?.method).toBe('POST');
    expect(refCall?.body?.ref).toBe('refs/heads/main');
  });

  it('parents the commit on the existing head when the branch exists', async () => {
    const calls = stubFetch([
      [/\/git\/ref\/heads\/main/, { object: { sha: 'head-sha' } }],
      [/\/git\/blobs/, { sha: 'blob-sha' }],
      [/\/git\/trees/, { sha: 'tree-sha' }],
      [/\/git\/commits/, { sha: 'commit-sha' }],
      [/\/git\/refs\/heads\/main/, { ref: 'refs/heads/main' }],
    ]);

    await pushFiles('tok', target, files, 'Update');

    const commit = calls.find((call) => call.url.includes('/git/commits'));
    expect(commit?.body?.parents).toEqual(['head-sha']);

    const update = calls.find((call) => call.method === 'PATCH');
    expect(update?.body?.sha).toBe('commit-sha');
    // Force-pushing would silently discard someone else's commit.
    expect(update?.body?.force).toBe(false);
  });

  /**
   * Building the tree from scratch rather than layering on `base_tree` is what
   * makes a deleted file actually disappear between versions.
   */
  it('sends the complete tree, not a patch onto the previous one', async () => {
    const calls = stubFetch([
      [/\/git\/ref\/heads\/main/, { object: { sha: 'head-sha' } }],
      [/\/git\/blobs/, { sha: 'blob-sha' }],
      [/\/git\/trees/, { sha: 'tree-sha' }],
      [/\/git\/commits/, { sha: 'commit-sha' }],
      [/\/git\/refs\/heads\/main/, {}],
    ]);

    await pushFiles('tok', target, files, 'Update');

    const tree = calls.find((call) => call.url.includes('/git/trees'));
    expect(tree?.body?.base_tree).toBeUndefined();
    expect((tree?.body?.tree as unknown[]).length).toBe(2);
  });

  it('encodes content as base64 so any byte survives', async () => {
    const calls = stubFetch([
      [/\/git\/ref\/heads\/main/, null],
      [/\/git\/blobs/, { sha: 'blob-sha' }],
      [/\/git\/trees/, { sha: 'tree-sha' }],
      [/\/git\/commits/, { sha: 'commit-sha' }],
      [/\/git\/refs$/, {}],
    ]);

    await pushFiles('tok', target, [{ path: 'a.txt', content: 'héllo — “quotes”' }], 'msg');

    const blob = calls.find((call) => call.url.includes('/git/blobs'));
    expect(blob?.body?.encoding).toBe('base64');
    expect(Buffer.from(String(blob?.body?.content), 'base64').toString('utf8')).toBe(
      'héllo — “quotes”',
    );
  });

  it('refuses an empty tree rather than creating an empty commit', async () => {
    stubFetch([]);
    await expect(pushFiles('tok', target, [], 'msg')).rejects.toThrow(/no files to push/);
  });
});

describe('vercel', () => {
  it.each([
    ['My App', 'my-app'],
    ['UPPER', 'upper'],
    ['weird!!name', 'weird-name'],
  ])('normalises the project name %s', (input, expected) => {
    expect(toProjectName(input)).toBe(expected);
  });

  it('deploys an inline file tree without needing a git repository', async () => {
    const calls = stubFetch([
      [/\/v13\/deployments/, { id: 'dpl_1', url: 'my-app.vercel.app', readyState: 'QUEUED' }],
    ]);

    const result = await createDeployment('tok', { projectName: 'My App', files: [{ path: 'index.html', content: '<p>hi</p>' }] });

    expect(result.id).toBe('dpl_1');
    expect(result.url).toBe('https://my-app.vercel.app');
    // Reports what Vercel actually said, rather than claiming it is live.
    expect(result.state).toBe('QUEUED');
    expect((calls[0]?.body?.files as unknown[]).length).toBe(1);
  });

  it('never reports a deployment as ready on its own initiative', async () => {
    stubFetch([[/\/v13\/deployments/, { id: 'dpl_2', url: 'x.vercel.app' }]]);
    const result = await createDeployment('tok', {
      projectName: 'app',
      files: [{ path: 'a', content: 'b' }],
    });
    expect(result.state).toBe('QUEUED');
    expect(result.state).not.toBe('READY');
  });

  it('refuses an empty deployment', async () => {
    stubFetch([]);
    await expect(
      createDeployment('tok', { projectName: 'app', files: [] }),
    ).rejects.toThrow(/no files to deploy/);
  });
});

describe('supabase', () => {
  it('creates a project and returns the one-time password to the caller', async () => {
    const calls = stubFetch([
      [/\/v1\/projects/, { id: 'proj_1', name: 'app', region: 'us-east-1', status: 'COMING_UP' }],
    ]);

    const project = await createProject('tok', {
      name: 'app',
      organizationId: 'org_1',
      databasePassword: 'a-sufficiently-long-password',
    });

    expect(project.id).toBe('proj_1');
    expect(project.apiUrl).toBe('https://proj_1.supabase.co');
    // Provisioning is asynchronous — the caller must poll, not assume.
    expect(project.status).toBe('COMING_UP');
    expect(calls[0]?.body?.db_pass).toBe('a-sufficiently-long-password');
  });

  // A weak password on a publicly reachable Postgres is not acceptable quietly.
  it('refuses a weak database password', async () => {
    stubFetch([]);
    await expect(
      createProject('tok', { name: 'a', organizationId: 'o', databasePassword: 'short' }),
    ).rejects.toThrow(IntegrationError);
  });
});

/**
 * Token refresh.
 *
 * GitHub only issues refresh tokens when the OAuth app has "Expire user access
 * tokens" enabled. Without a refresh implementation Reklu marks the connection
 * as needing attention every 8 hours — correct, but it pushes operators toward
 * disabling expiry and holding a non-expiring token instead. These tests cover
 * the rotation behaviour that makes the safer setting the convenient one.
 */
describe('github token refresh', () => {
  it('exchanges a refresh token for a new access token', async () => {
    const calls = stubFetch([
      [
        /login\/oauth\/access_token/,
        {
          access_token: 'gho_new',
          refresh_token: 'ghr_rotated',
          expires_in: 28_800,
          token_type: 'bearer',
          scope: 'repo,read:user',
        },
      ],
    ]);

    const tokens = await githubProvider.refresh!({
      credentials: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://reklu.app/cb' },
      refreshToken: 'ghr_old',
    });

    expect(tokens.accessToken).toBe('gho_new');
    // GitHub rotates the refresh token; storing the old one would break the
    // next refresh.
    expect(tokens.refreshToken).toBe('ghr_rotated');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(tokens.scopes).toEqual(['repo', 'read:user']);

    const body = new URLSearchParams(String(calls[0]?.rawBody));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('ghr_old');
  });

  /**
   * If GitHub omits a rotated token, keeping the existing one is the only way
   * the connection survives; dropping it would turn a refreshable connection
   * into one that dies permanently at the next expiry.
   */
  it('keeps the existing refresh token when none is returned', async () => {
    stubFetch([[/login\/oauth\/access_token/, { access_token: 'gho_new', expires_in: 28_800 }]]);

    const tokens = await githubProvider.refresh!({
      credentials: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://reklu.app/cb' },
      refreshToken: 'ghr_keep_me',
    });

    expect(tokens.refreshToken).toBe('ghr_keep_me');
  });

  it('fails loudly when no access token comes back', async () => {
    stubFetch([[/login\/oauth\/access_token/, { token_type: 'bearer' }]]);

    await expect(
      githubProvider.refresh!({
        credentials: { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://reklu.app/cb' },
        refreshToken: 'ghr_old',
      }),
    ).rejects.toThrow(/no access token/i);
  });
});
