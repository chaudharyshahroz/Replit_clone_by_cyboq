import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ShieldAlert, Wrench } from 'lucide-react';
import { buildProjects, db } from '@reklu/database';
import { sandboxStatus } from '@reklu/sandbox';
import { getAppContext } from '@/lib/auth-context';
import { NewBuildForm } from './new-build';

export const metadata: Metadata = { title: 'Build' };
export const dynamic = 'force-dynamic';

export default async function BuildPage() {
  const { workspace } = await getAppContext();
  const status = sandboxStatus();

  const projects = await db
    .select({
      id: buildProjects.id,
      name: buildProjects.name,
      target: buildProjects.target,
      status: buildProjects.status,
      versionCount: buildProjects.versionCount,
      updatedAt: buildProjects.updatedAt,
    })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.workspaceId, workspace.workspaceId), isNull(buildProjects.deletedAt)),
    )
    .orderBy(desc(buildProjects.updatedAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header>
        <h1 className="display flex items-center gap-2.5 text-3xl text-text">
          <Wrench className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Build
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Describe what you want. Reklu interprets the product, plans the architecture, and
          generates a working application you can preview and edit by conversation.
        </p>
      </header>

      {/*
        Spec §36 and §111: the isolation status is a security property, so it is
        stated before anything can be built — never discovered afterwards.
      */}
      {!status.available ? (
        <section className="mt-8 rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <ShieldAlert className="h-4 w-4 text-warning" strokeWidth={2} />
            Builds cannot run on this instance
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{status.detail}</p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Reklu will not fall back to running generated code without isolation, because that
            would execute untrusted code on the application server.
          </p>
        </section>
      ) : !status.isolated ? (
        <section className="mt-8 rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-text">
            <ShieldAlert className="h-4 w-4 text-warning" strokeWidth={2} />
            Sandbox is not isolated
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{status.detail}</p>
        </section>
      ) : null}

      {status.available ? (
        <section className="mt-8">
          <NewBuildForm />
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-sm font-medium text-text">Your builds</h2>
        {projects.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm leading-relaxed text-text-secondary">
            Nothing built yet. Describe a website, web app, dashboard or mobile app above and
            Reklu will generate it — with real navigation, real screens, and version history.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/build/${project.id}`}
                  className="block bg-surface/40 px-4 py-3.5 transition-colors hover:bg-surface-hover"
                >
                  <p className="truncate text-sm text-text">{project.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-text-muted">
                    <span>{project.target.replace(/_/g, ' ')}</span>
                    <span>{project.status}</span>
                    <span>v{project.versionCount}</span>
                    <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
