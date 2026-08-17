/**
 * Exporting a generated application to a connected service (spec §37–§38).
 *
 * This is where Build meets Connections: the file tree of a build version is
 * pushed to GitHub or deployed to Vercel using the workspace's stored OAuth
 * token.
 *
 * Two rules shape the code:
 *
 *   1. **The row is written before the external call**, and updated after —
 *      the same rule as the job queue (docs/DECISIONS.md D9). If the process
 *      dies mid-push, the user sees a deployment that started and failed,
 *      rather than nothing at all.
 *
 *   2. **Status is what the provider reported**, never what Reklu hopes. A
 *      Vercel deployment that answers QUEUED is recorded as `deploying`, not
 *      `ready` (spec §137).
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, deployments } from '@reklu/database';
import {
  accessTokenFor,
  githubDeploy,
  vercelDeploy,
  type PushableFile,
} from '@reklu/integrations';
import { errors, logger, newId } from '@reklu/shared';
import { loadTree } from './versions';

export interface ExportInput {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly connectionId: string;
  /** Defaults to the build project's name. */
  readonly name: string;
  readonly versionId?: string | undefined;
}

export interface ExportResult {
  readonly deploymentId: string;
  readonly url: string;
  readonly status: string;
  readonly detail: string;
}

/** Generated trees are small, but a runaway one should not be pushed blindly. */
export const MAX_EXPORT_FILES = 500;
export const MAX_EXPORT_BYTES = 20 * 1_048_576;

/**
 * Map a provider's deployment state onto Reklu's.
 *
 * Only a provider explicitly saying READY produces `ready`. Everything else —
 * including states this code has never seen — stays `deploying`, because
 * "unrecognised" must never be optimistically read as "live" (spec §137).
 */
export function toDeploymentStatus(providerState: string): 'ready' | 'failed' | 'deploying' {
  const state = providerState.trim().toUpperCase();
  if (state === 'READY') return 'ready';
  if (state === 'ERROR' || state === 'CANCELED' || state === 'CANCELLED') return 'failed';
  return 'deploying';
}

/** Why a tree cannot be exported, or undefined when it can. */
export function exportRejection(
  fileCount: number,
  totalBytes: number,
): string | undefined {
  if (fileCount === 0) return 'This build has no files yet. Generate the app first.';
  if (fileCount > MAX_EXPORT_FILES) {
    return `This build has ${fileCount} files, above the ${MAX_EXPORT_FILES} file export limit.`;
  }
  if (totalBytes > MAX_EXPORT_BYTES) return 'This build is too large to export in one request.';
  return undefined;
}

async function treeToPush(
  buildProjectId: string,
  workspaceId: string,
  versionId: string | undefined,
): Promise<readonly PushableFile[]> {
  const tree = await loadTree(buildProjectId, workspaceId, versionId);
  const bytes = tree.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);

  const rejection = exportRejection(tree.length, bytes);
  if (rejection) throw errors.validation(rejection);

  return tree.map((file) => ({ path: file.path, content: file.content }));
}

/** Record the attempt before doing anything that can fail or hang. */
async function openDeployment(
  input: ExportInput,
  provider: string,
): Promise<string> {
  const deploymentId = newId('deployment');
  await db.insert(deployments).values({
    id: deploymentId,
    workspaceId: input.workspaceId,
    buildProjectId: input.buildProjectId,
    buildVersionId: input.versionId ?? null,
    connectionId: input.connectionId,
    triggeredById: input.userId,
    provider,
    status: 'deploying',
    startedAt: new Date(),
  });
  return deploymentId;
}

async function closeDeployment(
  deploymentId: string,
  patch: Partial<typeof deployments.$inferInsert>,
): Promise<void> {
  await db
    .update(deployments)
    .set({ ...patch, completedAt: new Date() })
    .where(eq(deployments.id, deploymentId));
}

/**
 * Push the current tree to GitHub.
 *
 * Reuses a repository this build already pushed to, so a second export updates
 * the app rather than creating `my-app-2`.
 */
export async function exportToGitHub(input: ExportInput): Promise<ExportResult> {
  const files = await treeToPush(input.buildProjectId, input.workspaceId, input.versionId);
  const token = await accessTokenFor(input.connectionId, input.workspaceId);
  const deploymentId = await openDeployment(input, 'github');

  try {
    const login = await githubDeploy.currentLogin(token);
    const repoName = githubDeploy.toRepositoryName(input.name);

    const existing = await githubDeploy.getRepository(token, login, repoName);
    const target = existing ?? (await githubDeploy.createRepository(token, {
      name: input.name,
      description: 'Built with Reklu',
    }));

    const push = await githubDeploy.pushFiles(
      token,
      target,
      files,
      existing ? 'Update from Reklu' : 'Initial commit from Reklu',
    );

    await closeDeployment(deploymentId, {
      status: 'ready',
      externalId: push.commitSha,
      url: target.htmlUrl,
      statusDetail: `${push.fileCount} files on ${push.branch}`,
    });

    logger.info('Exported build to GitHub', {
      buildProjectId: input.buildProjectId,
      files: push.fileCount,
    });

    return {
      deploymentId,
      url: target.htmlUrl,
      status: 'ready',
      detail: `Pushed ${push.fileCount} files to ${target.owner}/${target.repo}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeDeployment(deploymentId, { status: 'failed', errorMessage: message });
    throw error;
  }
}

/**
 * Deploy the current tree to Vercel.
 *
 * Vercel builds asynchronously, so this finishes in `deploying`, not `ready`.
 * The URL is real but will 404 until the build completes — which is why the
 * result says so rather than presenting it as live.
 */
export async function deployToVercel(input: ExportInput): Promise<ExportResult> {
  const files = await treeToPush(input.buildProjectId, input.workspaceId, input.versionId);
  const token = await accessTokenFor(input.connectionId, input.workspaceId);
  const deploymentId = await openDeployment(input, 'vercel');

  try {
    const project = await vercelDeploy.ensureProject(token, input.name);
    const deployment = await vercelDeploy.createDeployment(token, {
      projectName: project.name,
      files,
    });

    // Map Vercel's vocabulary onto Reklu's, without inventing readiness.
    const status = toDeploymentStatus(deployment.state);

    await closeDeployment(deploymentId, {
      status,
      externalId: deployment.id,
      url: deployment.url,
      statusDetail: `Vercel reported ${deployment.state}`,
      // A first deploy from Reklu targets production, matching the API call.
      isProduction: true,
      productionUrl: deployment.url,
      completedAt: status === 'ready' ? new Date() : null,
    });

    return {
      deploymentId,
      url: deployment.url,
      status,
      detail:
        status === 'ready'
          ? 'Deployment is live.'
          : status === 'failed'
            ? `Vercel rejected this deployment (${deployment.state}).`
            : `Vercel is building this deployment (${deployment.state}). The URL works once it finishes.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeDeployment(deploymentId, { status: 'failed', errorMessage: message });
    throw error;
  }
}

export interface DeploymentSummary {
  readonly id: string;
  readonly provider: string;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly url: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
}

/** Export history for a build, newest first. */
export async function listDeployments(
  buildProjectId: string,
  workspaceId: string,
): Promise<DeploymentSummary[]> {
  const rows = await db
    .select({
      id: deployments.id,
      provider: deployments.provider,
      status: deployments.status,
      statusDetail: deployments.statusDetail,
      url: deployments.url,
      errorMessage: deployments.errorMessage,
      createdAt: deployments.createdAt,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.buildProjectId, buildProjectId),
        eq(deployments.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(deployments.createdAt))
    .limit(20);

  return rows;
}
