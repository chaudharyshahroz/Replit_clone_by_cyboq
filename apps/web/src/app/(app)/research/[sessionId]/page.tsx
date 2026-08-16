import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, FileText, Globe } from 'lucide-react';
import { Markdown } from '@/components/chat/markdown';
import { getAppContext } from '@/lib/auth-context';
import { loadResearch } from '@/lib/research';
import { ConvertActions } from './convert-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { user, workspace } = await getAppContext();
  const { sessionId } = await params;
  const detail = await loadResearch(user, workspace.workspaceId, sessionId);
  return { title: detail?.session.query.slice(0, 60) ?? 'Research' };
}

export default async function ResearchDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { user, workspace } = await getAppContext();
  const { sessionId } = await params;

  const detail = await loadResearch(user, workspace.workspaceId, sessionId);
  if (!detail) notFound();

  const { session, sources, failedSources } = detail;
  const totalAttempted = sources.length + failedSources.length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header>
        <Link href="/research" className="rounded text-sm text-text-muted hover:text-text">
          ← Research
        </Link>
        <h1 className="display mt-3 text-2xl text-text">{session.query}</h1>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span className="rounded-md border border-border-strong px-2 py-0.5">{session.mode}</span>
          <span>{session.createdAt.toLocaleString()}</span>
          {/* Spec §88: partial retrieval reported as partial. */}
          <span>
            {sources.length} of {totalAttempted} sources retrieved
          </span>
          {session.sourcesUsed > 0 ? <span>{session.sourcesUsed} cited</span> : null}
        </div>
      </header>

      {session.stage === 'failed' ? (
        <p
          role="alert"
          className="mt-8 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-text"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} />
          {session.errorMessage ?? 'This research run failed.'}
        </p>
      ) : null}

      {session.report ? (
        <>
          <article className="mt-8 rounded-xl border border-border bg-surface/40 p-6">
            <Markdown content={session.report} />
          </article>

          {/* Spec §26: research must lead to execution. */}
          <section className="mt-6">
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Use this research
            </h2>
            <ConvertActions sessionId={sessionId} />
          </section>
        </>
      ) : null}

      {/* ---- Sources panel (spec §25) ---- */}
      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">Sources</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Every source Reklu retrieved, and the claims each one supports.
        </p>

        {sources.length === 0 ? (
          <p className="mt-4 rounded-xl border border-border bg-surface/40 p-6 text-sm text-text-secondary">
            No sources were retrieved for this run.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {sources.map((source) => (
              <li
                key={source.id}
                className="rounded-xl border border-border bg-surface/40 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-raised font-mono text-[11px] text-text-muted">
                    {source.citationIndex ?? '–'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {source.type === 'file' ? (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                      ) : (
                        <Globe className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                      )}
                      {source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="truncate rounded text-sm text-accent hover:text-accent-hover"
                        >
                          {source.title ?? source.url}
                        </a>
                      ) : (
                        <span className="truncate text-sm text-text">{source.title}</span>
                      )}
                    </div>

                    {source.domain ? (
                      <p className="mt-0.5 text-[11px] text-text-muted">{source.domain}</p>
                    ) : null}

                    {source.snippet ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                        {source.snippet}
                      </p>
                    ) : null}

                    {/*
                      The passage is what makes a citation checkable: a reviewer
                      can see whether the source actually says what was claimed.
                    */}
                    {source.citations.length > 0 ? (
                      <details className="group mt-3">
                        <summary className="cursor-pointer rounded text-xs text-text-muted hover:text-text-secondary">
                          Supports {source.citations.length} claim
                          {source.citations.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {source.citations.map((citation, index) => (
                            <li
                              key={index}
                              className="rounded-lg border border-border bg-canvas p-3"
                            >
                              <p className="text-xs text-text">{citation.claim}</p>
                              {citation.passage ? (
                                <blockquote className="mt-2 border-l-2 border-border-strong pl-2 text-[11px] leading-relaxed text-text-secondary">
                                  {citation.passage}
                                </blockquote>
                              ) : (
                                // Honest gap rather than a misleading exhibit.
                                <p className="mt-2 text-[11px] text-text-muted">
                                  No supporting passage could be located in this source.
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Failures shown, not hidden. */}
        {failedSources.length > 0 ? (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <h3 className="text-xs font-medium text-text">
              {failedSources.length} source{failedSources.length === 1 ? '' : 's'} could not be read
            </h3>
            <ul className="mt-2 space-y-1">
              {failedSources.map((source) => (
                <li key={source.id} className="text-[11px] text-text-secondary">
                  <span className="text-text-muted">{source.domain ?? source.title}</span> —{' '}
                  {source.fetchError}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
