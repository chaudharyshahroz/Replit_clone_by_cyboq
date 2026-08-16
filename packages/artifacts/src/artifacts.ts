/**
 * The universal artifact system (spec §19–20).
 *
 * A document, a deck, an image, a generated app and a research report are all
 * artifacts distinguished by `type`. That is what makes "turn this research
 * into a presentation" a transformation between two rows rather than an
 * integration between two features (DECISIONS.md D6).
 *
 * Versions are **append-only**. Every AI edit adds a version rather than
 * overwriting, so a model that ruins a good document can always be undone
 * (spec §33).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  artifactVersions,
  artifacts,
  db,
  type Artifact,
  type ArtifactVersion,
} from '@reklu/database';
import { errors, newId, slugify } from '@reklu/shared';

export type ArtifactType = Artifact['type'];

export interface CreateArtifactInput {
  readonly workspaceId: string;
  readonly projectId?: string | null;
  readonly userId: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly description?: string | null;
  /** Structured content for text-shaped artifacts. */
  readonly content?: unknown;
  readonly contentText?: string | null;
  /** Storage key for binary artifacts (images, video, exports). */
  readonly storageKey?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly modelKey?: string | null;
  readonly sourceConversationId?: string | null;
  readonly sourceMessageId?: string | null;
  readonly sourceResearchId?: string | null;
  /** Set when derived from another artifact, preserving the chain. */
  readonly derivedFromArtifactId?: string | null;
}

async function uniqueSlug(projectId: string | null, title: string): Promise<string> {
  const root = slugify(title);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          projectId === null ? isNull(artifacts.projectId) : eq(artifacts.projectId, projectId),
          eq(artifacts.slug, candidate),
        ),
      )
      .limit(1);
    if (!existing) return candidate;
  }
  return `${root}-${newId('artifact').slice(-6)}`;
}

export interface ArtifactWithVersion {
  readonly artifact: Artifact;
  readonly version: ArtifactVersion;
}

/** Create an artifact and its first version, atomically. */
export async function createArtifact(
  input: CreateArtifactInput,
): Promise<ArtifactWithVersion> {
  const title = input.title.trim();
  if (title.length === 0) throw errors.validation('An artifact needs a title.');

  const artifactId = newId('artifact');
  const versionId = newId('artifactVersion');
  const slug = await uniqueSlug(input.projectId ?? null, title);

  await db.transaction(async (tx) => {
    await tx.insert(artifacts).values({
      id: artifactId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      createdById: input.userId,
      type: input.type,
      title,
      slug,
      description: input.description?.trim() || null,
      status: 'ready',
      currentVersionId: versionId,
      versionCount: 1,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      sourceResearchId: input.sourceResearchId ?? null,
      derivedFromArtifactId: input.derivedFromArtifactId ?? null,
      metadata: input.metadata ?? {},
      createdBy: input.userId,
    });

    await tx.insert(artifactVersions).values({
      id: versionId,
      artifactId,
      workspaceId: input.workspaceId,
      version: 1,
      content: (input.content ?? null) as never,
      contentText: input.contentText ?? null,
      storageKey: input.storageKey ?? null,
      changeSummary: 'Created',
      createdById: input.userId,
      modelKey: input.modelKey ?? null,
      metadata: input.metadata ?? {},
    });
  });

  return loadArtifact(artifactId, input.workspaceId) as Promise<ArtifactWithVersion>;
}

export interface ReviseArtifactInput {
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly content?: unknown;
  readonly contentText?: string | null;
  readonly storageKey?: string | null;
  readonly changeSummary: string;
  readonly modelKey?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Append a new version.
 *
 * The version number is computed inside the transaction from the current max,
 * so two concurrent edits cannot both claim the same number — the unique index
 * on (artifactId, version) would reject the loser, which is the correct
 * outcome rather than silent overwrite.
 */
export async function reviseArtifact(
  input: ReviseArtifactInput,
): Promise<ArtifactWithVersion> {
  const versionId = newId('artifactVersion');

  await db.transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, input.artifactId),
          eq(artifacts.workspaceId, input.workspaceId),
          isNull(artifacts.deletedAt),
        ),
      )
      .limit(1);

    if (!artifact) throw errors.notFound('Artifact', input.artifactId);

    const [highest] = await tx
      .select({ max: sql<number>`coalesce(max(${artifactVersions.version}), 0)` })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, input.artifactId));

    const nextVersion = Number(highest?.max ?? 0) + 1;

    await tx.insert(artifactVersions).values({
      id: versionId,
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      version: nextVersion,
      content: (input.content ?? null) as never,
      contentText: input.contentText ?? null,
      storageKey: input.storageKey ?? null,
      changeSummary: input.changeSummary,
      createdById: input.userId,
      modelKey: input.modelKey ?? null,
      metadata: input.metadata ?? {},
    });

    await tx
      .update(artifacts)
      .set({
        currentVersionId: versionId,
        versionCount: nextVersion,
        updatedBy: input.userId,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      })
      .where(eq(artifacts.id, input.artifactId));
  });

  return loadArtifact(input.artifactId, input.workspaceId) as Promise<ArtifactWithVersion>;
}

/**
 * Restore a previous version.
 *
 * Implemented as a **new version carrying the old content**, not as a pointer
 * move. History stays append-only, so "restore v2" is itself undoable.
 */
export async function restoreVersion(params: {
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly version: number;
}): Promise<ArtifactWithVersion> {
  const [target] = await db
    .select()
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, params.artifactId),
        eq(artifactVersions.workspaceId, params.workspaceId),
        eq(artifactVersions.version, params.version),
      ),
    )
    .limit(1);

  if (!target) throw errors.notFound('Artifact version', String(params.version));

  return reviseArtifact({
    artifactId: params.artifactId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    content: target.content,
    contentText: target.contentText,
    storageKey: target.storageKey,
    changeSummary: `Restored version ${params.version}`,
  });
}

export async function loadArtifact(
  artifactId: string,
  workspaceId: string,
): Promise<ArtifactWithVersion | undefined> {
  const [row] = await db
    .select({ artifact: artifacts, version: artifactVersions })
    .from(artifacts)
    .innerJoin(artifactVersions, eq(artifacts.currentVersionId, artifactVersions.id))
    .where(
      and(
        eq(artifacts.id, artifactId),
        eq(artifacts.workspaceId, workspaceId),
        isNull(artifacts.deletedAt),
      ),
    )
    .limit(1);

  return row ? { artifact: row.artifact, version: row.version } : undefined;
}

export async function listVersions(
  artifactId: string,
  workspaceId: string,
): Promise<readonly ArtifactVersion[]> {
  return db
    .select()
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, artifactId),
        eq(artifactVersions.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(artifactVersions.version));
}

export interface ListArtifactsOptions {
  readonly projectId?: string | null;
  readonly type?: ArtifactType;
  readonly limit?: number;
}

export async function listArtifacts(
  workspaceId: string,
  options: ListArtifactsOptions = {},
): Promise<readonly Artifact[]> {
  const conditions = [eq(artifacts.workspaceId, workspaceId), isNull(artifacts.deletedAt)];
  if (options.projectId) conditions.push(eq(artifacts.projectId, options.projectId));
  if (options.type) conditions.push(eq(artifacts.type, options.type));

  return db
    .select()
    .from(artifacts)
    .where(and(...conditions))
    .orderBy(desc(artifacts.updatedAt))
    .limit(options.limit ?? 100);
}

export async function deleteArtifact(
  artifactId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const removed = await db
    .update(artifacts)
    .set({ deletedAt: new Date(), updatedBy: userId })
    .where(
      and(
        eq(artifacts.id, artifactId),
        eq(artifacts.workspaceId, workspaceId),
        isNull(artifacts.deletedAt),
      ),
    )
    .returning({ id: artifacts.id });

  if (removed.length === 0) throw errors.notFound('Artifact', artifactId);
}

/**
 * Derive a new artifact from an existing one — research → document → deck.
 *
 * `derivedFromArtifactId` preserves the chain so provenance stays answerable:
 * "where did this deck come from?" has a real answer.
 */
export async function deriveArtifact(params: {
  readonly sourceArtifactId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly content?: unknown;
  readonly contentText?: string | null;
  readonly modelKey?: string | null;
}): Promise<ArtifactWithVersion> {
  const source = await loadArtifact(params.sourceArtifactId, params.workspaceId);
  if (!source) throw errors.notFound('Artifact', params.sourceArtifactId);

  return createArtifact({
    workspaceId: params.workspaceId,
    projectId: source.artifact.projectId,
    userId: params.userId,
    type: params.type,
    title: params.title,
    content: params.content,
    contentText: params.contentText ?? null,
    modelKey: params.modelKey ?? null,
    derivedFromArtifactId: params.sourceArtifactId,
    sourceResearchId: source.artifact.sourceResearchId,
  });
}
