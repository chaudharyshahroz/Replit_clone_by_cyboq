import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { listArtifacts } from '@reklu/artifacts';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Artifacts' };
export const dynamic = 'force-dynamic';

export default async function ArtifactsPage() {
  const { workspace } = await getAppContext();
  const artifacts = await listArtifacts(workspace.workspaceId);

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <h1 className="display text-3xl text-text">Artifacts</h1>
        <p className="mt-2 max-w-xl text-pretty text-text-secondary">
          Documents, presentations, images, research reports and generated applications — each
          with full version history.
        </p>
      </header>

      {artifacts.length === 0 ? (
        <div className="mt-14 rounded-xl border border-border bg-surface/40 p-12 text-center">
          <Boxes className="mx-auto h-6 w-6 text-text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-text">No artifacts yet</p>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-text-secondary">
            When Reklu creates something substantial — a document, a deck, a report — it appears
            here and can be revised, restored and turned into other formats.
          </p>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <Link
                href={`/artifacts/${artifact.id}`}
                className="flex items-center gap-3 bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
              >
                <Boxes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{artifact.title}</span>
                  <span className="block text-xs text-text-muted">
                    {artifact.type.replace(/_/g, ' ')} · v{artifact.versionCount} ·{' '}
                    {new Date(artifact.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
