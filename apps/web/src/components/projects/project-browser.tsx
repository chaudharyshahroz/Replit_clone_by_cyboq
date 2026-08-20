'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Boxes, Brain, FileText, FolderPlus, MessageSquare, Search } from 'lucide-react';
import { NewProjectButton } from '@/components/projects/new-project';

export interface ProjectCard {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly conversationCount: number;
  readonly fileCount: number;
  readonly artifactCount: number;
  readonly memoryCount: number;
}

/**
 * Filtering happens in the browser over the list the server already sent.
 *
 * A workspace's projects are a short list — tens, not thousands — so a round
 * trip per keystroke would add latency to something that can be instant. If
 * that stops being true, this becomes a server query with a cursor.
 */
export function ProjectBrowser({ projects }: { projects: readonly ProjectCard[] }) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        (project.description ?? '').toLowerCase().includes(needle),
    );
  }, [projects, query]);

  if (projects.length === 0) {
    return (
      // Spec §90 — say what a project is for, not just "nothing here".
      <div className="mt-14 rounded-xl border border-border bg-surface/40 p-12 text-center">
        <FolderPlus className="mx-auto h-6 w-6 text-text-muted" strokeWidth={1.5} />
        <p className="mt-4 text-text">No projects yet</p>
        <p className="mx-auto mt-2 max-w-sm text-pretty text-sm leading-relaxed text-text-secondary">
          Create a project to keep your chats, files, research and builds together. Reklu carries
          the context forward across all of them.
        </p>
        <div className="mt-6 flex justify-center">
          <NewProjectButton />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative mt-10">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          strokeWidth={1.75}
        />
        <label htmlFor="project-search" className="sr-only">
          Search projects
        </label>
        <input
          id="project-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-lg border border-border-strong bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
      </div>

      {matches.length === 0 ? (
        <p className="mt-10 rounded-xl border border-border bg-surface/40 p-10 text-center text-sm text-text-secondary">
          No project matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {matches.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block h-full rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong hover:bg-surface"
              >
                <h2 className="truncate text-sm font-medium text-text">{project.name}</h2>
                {project.description ? (
                  <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">
                    {project.description}
                  </p>
                ) : null}

                <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.6875rem] text-text-muted">
                  <div className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Chats</dt>
                    <dd>{project.conversationCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Files</dt>
                    <dd>{project.fileCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <Boxes className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Artifacts</dt>
                    <dd>{project.artifactCount}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <Brain className="h-3 w-3" strokeWidth={1.75} />
                    <dt className="sr-only">Memories</dt>
                    <dd>{project.memoryCount}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
