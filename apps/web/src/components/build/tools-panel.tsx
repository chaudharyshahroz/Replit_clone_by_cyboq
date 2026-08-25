'use client';

import { ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { ExportPanel } from './export-panel';
import { PublishPanel } from './publish-panel';

/**
 * Everything about the project that is not its code.
 *
 * This was a Deploy tab holding two export buttons, which made the rest of what
 * a project has — where it is served, the domain in front of it, what it is
 * allowed to do, the standards it was built to — look like it did not exist.
 *
 * Only real things are listed. A row for a feature Reklu does not have would be
 * a promise the tab cannot keep, and the panel is more useful short and true
 * than long and aspirational.
 */
export function ToolsPanel({
  buildId,
  hasFiles,
  target,
  sandboxIsolated,
  sandboxDetail,
  fileCount,
  checkpointCount,
}: {
  buildId: string;
  hasFiles: boolean;
  target: string;
  sandboxIsolated: boolean;
  sandboxDetail: string;
  fileCount: number;
  checkpointCount: number;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <PublishPanel buildId={buildId} hasFiles={hasFiles} />
      <ExportPanel buildId={buildId} hasFiles={hasFiles} />

      {/* ---- What this project is ---- */}
      <section className="rounded-xl border border-border bg-surface/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Standards applied
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
          Every generation works to these, on top of the brief. They are the difference between
          code that demos and code you can ship.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs text-text-secondary">
          {[
            ['Engineering', 'Types, states, validation, accessibility, no hard-coded secrets'],
            ...(target === 'api'
              ? []
              : ([
                  ['Pictures', 'Described in the alt text and drawn by Reklu, never linked from a URL'],
                  ['Performance', 'Sized images, no needless dependency, nothing above the fold waiting on data'],
                ] as const)),
            [labelFor(target), summaryFor(target)],
          ].map(([name, detail]) => (
            <li key={name} className="flex gap-2">
              <span className="w-24 shrink-0 text-text">{name}</span>
              <span className="min-w-0 flex-1">{detail}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Where the code runs ---- */}
      <section className="rounded-xl border border-border bg-surface/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <ShieldCheck
            className={`h-4 w-4 ${sandboxIsolated ? 'text-success' : 'text-warning'}`}
            strokeWidth={1.75}
          />
          Where this runs
        </h2>
        {/*
          Stated plainly, including when the answer is not the good one. Spec
          §111: a development convenience must never be mistaken for isolation.
        */}
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{sandboxDetail}</p>
      </section>

      {/* ---- What is here ---- */}
      <section className="rounded-xl border border-border bg-surface/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <UploadCloud className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
          This project
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-text-muted">Kind</dt>
          <dd className="text-text">{target.replace(/_/g, ' ')}</dd>
          <dt className="text-text-muted">Files</dt>
          <dd className="text-text">{fileCount}</dd>
          <dt className="text-text-muted">Versions</dt>
          <dd className="text-text">{checkpointCount}</dd>
        </dl>
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-text-muted">
          Every version is kept. The History tab restores any of them.
        </p>
      </section>
    </div>
  );
}

function labelFor(target: string): string {
  const names: Record<string, string> = {
    website: 'Marketing site',
    web_app: 'Web app',
    dashboard: 'Dashboard',
    mobile_app: 'Mobile app',
    api: 'API',
  };
  return names[target] ?? 'Application';
}

function summaryFor(target: string): string {
  const summaries: Record<string, string> = {
    website: 'Real copy, semantic landmarks, metadata, responsive from 360px',
    web_app: 'A deliberate server/client boundary, one source of truth for data',
    dashboard: 'Summary before detail, labelled axes, never invented data',
    mobile_app: 'Safe areas, 44pt targets, the offline case handled',
    api: 'Validated input, correct status codes, nothing unpaginated',
  };
  return summaries[target] ?? 'Standards for this kind of application';
}
