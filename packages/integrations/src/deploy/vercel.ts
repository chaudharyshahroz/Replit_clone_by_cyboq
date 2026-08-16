/**
 * Deploying a generated application to Vercel (spec §38).
 *
 * Vercel's deployment API accepts an inline file list, so a generated app can
 * be deployed without an intermediate Git repository. That matters: a user who
 * has connected Vercel but not GitHub should still be able to ship.
 */
import { getJsonOrNull, sendJson } from '../http';
import { IntegrationError } from '../types';
import type { PushableFile } from './github';

const API = 'https://api.vercel.com';

export interface VercelProject {
  readonly id: string;
  readonly name: string;
}

export interface DeploymentResult {
  readonly id: string;
  /** Where the deployment will serve once it finishes building. */
  readonly url: string;
  /** Vercel's own state — reported as-is, never assumed to be 'READY'. */
  readonly state: string;
  readonly inspectorUrl?: string | undefined;
}

/** Vercel project names are lowercase, alphanumeric and hyphens, max 100. */
export function toProjectName(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    // See toRepositoryName: combining marks must go before the class filter.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100);
  return cleaned || 'reklu-app';
}

/** Query string for a team-scoped call, empty for a personal account. */
function scope(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
}

export async function findProject(
  accessToken: string,
  name: string,
  teamId?: string,
): Promise<VercelProject | null> {
  const project = await getJsonOrNull<VercelProject>(
    'vercel',
    `${API}/v9/projects/${encodeURIComponent(name)}${scope(teamId)}`,
    accessToken,
  );
  return project;
}

export async function createProject(
  accessToken: string,
  name: string,
  teamId?: string,
): Promise<VercelProject> {
  return sendJson<VercelProject>(
    'vercel',
    'POST',
    `${API}/v10/projects${scope(teamId)}`,
    accessToken,
    { name: toProjectName(name), framework: 'nextjs' },
  );
}

/** Reuse a project of this name if it exists, so redeploying is not a new app. */
export async function ensureProject(
  accessToken: string,
  name: string,
  teamId?: string,
): Promise<VercelProject> {
  const normalized = toProjectName(name);
  return (await findProject(accessToken, normalized, teamId)) ?? createProject(accessToken, normalized, teamId);
}

/**
 * Create a deployment from an in-memory file tree.
 *
 * Returns as soon as Vercel accepts the files — the build runs on their side.
 * The returned `state` is whatever Vercel actually reported; this never claims
 * a deployment is live before it is (spec §137).
 */
export async function createDeployment(
  accessToken: string,
  options: {
    projectName: string;
    files: readonly PushableFile[];
    teamId?: string | undefined;
    /** false creates a preview deployment instead of promoting to production. */
    production?: boolean | undefined;
  },
): Promise<DeploymentResult> {
  if (options.files.length === 0) {
    throw new IntegrationError('vercel', 'There are no files to deploy.');
  }

  const deployment = await sendJson<{
    id: string;
    url: string;
    readyState?: string;
    status?: string;
    inspectorUrl?: string;
  }>('vercel', 'POST', `${API}/v13/deployments${scope(options.teamId)}`, accessToken, {
    name: toProjectName(options.projectName),
    target: options.production === false ? undefined : 'production',
    files: options.files.map((file) => ({
      file: file.path,
      data: Buffer.from(file.content, 'utf8').toString('base64'),
      encoding: 'base64',
    })),
    projectSettings: { framework: 'nextjs' },
  });

  return {
    id: deployment.id,
    url: deployment.url.startsWith('http') ? deployment.url : `https://${deployment.url}`,
    state: deployment.readyState ?? deployment.status ?? 'QUEUED',
    inspectorUrl: deployment.inspectorUrl,
  };
}

/** Poll a deployment's real state. Used to report progress, never to fake it. */
export async function deploymentState(
  accessToken: string,
  deploymentId: string,
  teamId?: string,
): Promise<string> {
  const deployment = await getJsonOrNull<{ readyState?: string; status?: string }>(
    'vercel',
    `${API}/v13/deployments/${encodeURIComponent(deploymentId)}${scope(teamId)}`,
    accessToken,
  );
  return deployment?.readyState ?? deployment?.status ?? 'UNKNOWN';
}
