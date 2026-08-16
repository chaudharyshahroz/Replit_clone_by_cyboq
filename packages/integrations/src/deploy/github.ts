/**
 * Pushing a generated application to GitHub (spec §37).
 *
 * Uses the Git Data API — blobs, tree, commit, ref — rather than the Contents
 * API, because Contents commits one file per request. A generated app is
 * dozens of files, and committing them individually would produce dozens of
 * commits and hit rate limits on the way.
 *
 * The whole tree lands as **one commit**, which is also what makes the push
 * atomic from the user's point of view: either the repository has the app or it
 * is untouched.
 */
import { getJson, getJsonOrNull, sendJson } from '../http';
import { IntegrationError } from '../types';

const API = 'https://api.github.com';
const ACCEPT = { Accept: 'application/vnd.github+json' };

/** Non-executable file. Reklu never generates symlinks or submodules. */
const FILE_MODE = '100644';

export interface RepositoryTarget {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly htmlUrl: string;
}

export interface PushableFile {
  readonly path: string;
  readonly content: string;
}

export interface PushResult {
  readonly commitSha: string;
  readonly branch: string;
  readonly htmlUrl: string;
  readonly fileCount: number;
}

interface RepoResponse {
  readonly name: string;
  readonly default_branch: string;
  readonly html_url: string;
  readonly owner: { readonly login: string };
}

/**
 * GitHub rejects many names Reklu might derive from a project title. Normalise
 * rather than letting the API reject the push after the user has waited.
 */
export function toRepositoryName(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    // NFKD splits é into e + a combining accent. The accent is not a word
    // character, so leaving it in turns every accented letter into a hyphen.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100);
  return cleaned.toLowerCase() || 'reklu-app';
}

export async function createRepository(
  accessToken: string,
  options: {
    name: string;
    description?: string | undefined;
    /** Defaults to private: a generated app is the user's, not the world's. */
    isPrivate?: boolean | undefined;
  },
): Promise<RepositoryTarget> {
  const repo = await sendJson<RepoResponse>(
    'github',
    'POST',
    `${API}/user/repos`,
    accessToken,
    {
      name: toRepositoryName(options.name),
      description: options.description ?? 'Built with Reklu',
      private: options.isPrivate ?? true,
      // No auto-init: an empty repository lets the first push be the app itself
      // rather than a merge against a README nobody asked for.
      auto_init: false,
    },
    ACCEPT,
  );

  return {
    owner: repo.owner.login,
    repo: repo.name,
    branch: repo.default_branch || 'main',
    htmlUrl: repo.html_url,
  };
}

/** An existing repository, for pushing an update rather than a first export. */
export async function getRepository(
  accessToken: string,
  owner: string,
  repo: string,
): Promise<RepositoryTarget | null> {
  const found = await getJsonOrNull<RepoResponse>(
    'github',
    `${API}/repos/${owner}/${repo}`,
    accessToken,
    ACCEPT,
  );
  if (!found) return null;
  return {
    owner: found.owner.login,
    repo: found.name,
    branch: found.default_branch || 'main',
    htmlUrl: found.html_url,
  };
}

/**
 * Push a complete file tree as one commit.
 *
 * Handles both an empty repository (no ref yet, commit has no parent) and an
 * existing one (commit parented on the current head). The tree is built from
 * scratch rather than layered on `base_tree`, so a file deleted between
 * versions actually disappears instead of lingering forever.
 */
export async function pushFiles(
  accessToken: string,
  target: RepositoryTarget,
  files: readonly PushableFile[],
  message: string,
): Promise<PushResult> {
  if (files.length === 0) {
    throw new IntegrationError('github', 'There are no files to push.');
  }

  const base = `${API}/repos/${target.owner}/${target.repo}`;
  const ref = `heads/${target.branch}`;

  // Absent on a repository that has never been pushed to. That is expected for
  // a first export, not an error.
  const head = await getJsonOrNull<{ object: { sha: string } }>(
    'github',
    `${base}/git/ref/${ref}`,
    accessToken,
    ACCEPT,
  );

  // base64 so any byte sequence survives; JSON string escaping would not.
  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await sendJson<{ sha: string }>(
        'github',
        'POST',
        `${base}/git/blobs`,
        accessToken,
        { content: Buffer.from(file.content, 'utf8').toString('base64'), encoding: 'base64' },
        ACCEPT,
      );
      return { path: file.path, mode: FILE_MODE, type: 'blob' as const, sha: blob.sha };
    }),
  );

  const tree = await sendJson<{ sha: string }>(
    'github',
    'POST',
    `${base}/git/trees`,
    accessToken,
    { tree: blobs },
    ACCEPT,
  );

  const commit = await sendJson<{ sha: string }>(
    'github',
    'POST',
    `${base}/git/commits`,
    accessToken,
    {
      message,
      tree: tree.sha,
      parents: head ? [head.object.sha] : [],
    },
    ACCEPT,
  );

  if (head) {
    await sendJson(
      'github',
      'PATCH',
      `${base}/git/refs/${ref}`,
      accessToken,
      // No force: a ref that moved under us means someone else pushed, and
      // silently overwriting their commit is not ours to do.
      { sha: commit.sha, force: false },
      ACCEPT,
    );
  } else {
    await sendJson(
      'github',
      'POST',
      `${base}/git/refs`,
      accessToken,
      { ref: `refs/${ref}`, sha: commit.sha },
      ACCEPT,
    );
  }

  return {
    commitSha: commit.sha,
    branch: target.branch,
    htmlUrl: `${target.htmlUrl}/tree/${target.branch}`,
    fileCount: files.length,
  };
}

/** The account's login, used to build repository URLs. */
export async function currentLogin(accessToken: string): Promise<string> {
  const user = await getJson<{ login: string }>('github', `${API}/user`, accessToken, ACCEPT);
  return user.login;
}
