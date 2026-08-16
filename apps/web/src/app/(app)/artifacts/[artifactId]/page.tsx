import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listVersions, loadArtifact } from '@reklu/artifacts';
import { getAppContext } from '@/lib/auth-context';
import { Markdown } from '@/components/chat/markdown';
import { VersionHistory } from './version-history';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ artifactId: string }>;
}): Promise<Metadata> {
  const { workspace } = await getAppContext();
  const { artifactId } = await params;
  const loaded = await loadArtifact(artifactId, workspace.workspaceId);
  return { title: loaded?.artifact.title ?? 'Artifact' };
}

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ artifactId: string }>;
}) {
  const { workspace } = await getAppContext();
  const { artifactId } = await params;

  const loaded = await loadArtifact(artifactId, workspace.workspaceId);
  if (!loaded) notFound();

  const versions = await listVersions(artifactId, workspace.workspaceId);
  const { artifact, version } = loaded;

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        {artifact.projectId ? (
          <Link
            href={`/projects/${artifact.projectId}`}
            className="rounded text-sm text-text-muted hover:text-text"
          >
            ← Project
          </Link>
        ) : (
          <Link href="/projects" className="rounded text-sm text-text-muted hover:text-text">
            ← Projects
          </Link>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="display text-3xl text-text">{artifact.title}</h1>
          <span className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-text-secondary">
            {artifact.type.replace(/_/g, ' ')}
          </span>
          <span className="font-mono text-xs text-text-muted">v{version.version}</span>
        </div>

        {artifact.description ? (
          <p className="mt-2 text-pretty text-text-secondary">{artifact.description}</p>
        ) : null}

        {artifact.derivedFromArtifactId ? (
          // Provenance is the point of the artifact chain — surface it.
          <p className="mt-3 text-sm text-text-muted">
            Derived from{' '}
            <Link
              href={`/artifacts/${artifact.derivedFromArtifactId}`}
              className="rounded text-accent hover:text-accent-hover"
            >
              another artifact
            </Link>
          </p>
        ) : null}
      </header>

      <article className="mt-10 rounded-xl border border-border bg-surface/40 p-6">
        {version.contentText ? (
          <Markdown content={version.contentText} />
        ) : version.storageKey ? (
          <p className="text-sm text-text-secondary">
            This artifact is stored as a file.{' '}
            <a
              href={`/api/files/${version.storageKey}`}
              className="rounded text-accent hover:text-accent-hover"
            >
              Download it
            </a>
            .
          </p>
        ) : (
          <p className="text-sm text-text-muted">This version has no content.</p>
        )}
      </article>

      <section className="mt-10">
        <VersionHistory
          artifactId={artifactId}
          currentVersion={version.version}
          versions={versions.map((v) => ({
            id: v.id,
            version: v.version,
            changeSummary: v.changeSummary,
            modelKey: v.modelKey,
            createdAt: v.createdAt.toISOString(),
          }))}
        />
      </section>
    </div>
  );
}
