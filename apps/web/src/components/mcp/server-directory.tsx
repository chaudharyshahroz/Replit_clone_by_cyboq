'use client';

import { useState, useTransition } from 'react';
import { ExternalLink, Loader2, Lock, Search } from 'lucide-react';
import { searchRegistryAction } from '@/app/(app)/settings/mcp/actions';
import type { RegistryServer } from '@reklu/mcp';

/**
 * Finding a server to connect, rather than having to already know one.
 *
 * Reklu could always connect to an MCP server. What it could not do was say
 * which ones exist, so the form asked for an endpoint that almost nobody has
 * memorised — and the feature looked empty to everybody who did not.
 *
 * The list is the registry's, read when somebody looks. Not a list in Reklu:
 * endpoints published by other people are withdrawn and moved, and a stale one
 * fails in a way that reads as Reklu being broken rather than the world moving.
 */
export function ServerDirectory({ onPick }: { onPick: (server: RegistryServer) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly RegistryServer[] | null>(null);
  const [pending, startTransition] = useTransition();

  const search = () => {
    startTransition(async () => {
      setResults(await searchRegistryAction(query));
    });
  };

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
        className="flex gap-2"
      >
        <label htmlFor="registry-search" className="sr-only">
          Search for a server
        </label>
        <input
          id="registry-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search: notion, linear, sentry, stripe…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent-border focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Search className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Search
        </button>
      </form>

      {results !== null && results.length === 0 && !pending ? (
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          Nothing came back. The registry lists servers reachable over https — a server that
          runs as a local process is not one Reklu can connect to, since it does not run other
          people&apos;s code on its own machine.
        </p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {results.map((server) => (
            <li
              key={server.name}
              className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                  {server.title}
                  {server.needsCredential ? (
                    <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.625rem] text-text-muted">
                      <Lock className="h-2.5 w-2.5" strokeWidth={2} />
                      token required
                    </span>
                  ) : null}
                </p>
                {server.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                    {server.description}
                  </p>
                ) : null}
                <p className="mt-1 truncate font-mono text-[0.6875rem] text-text-muted">
                  {server.url}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {server.repository ? (
                  <a
                    href={server.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[0.6875rem] text-text-muted hover:text-text"
                  >
                    Source
                    <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
                  </a>
                ) : null}
                {/*
                  Fills the form rather than connecting. A server is somebody
                  else's code reached over the network, and the tools it offers
                  arrive disabled pending review — so the last step before that
                  begins is a deliberate one.
                */}
                <button
                  type="button"
                  onClick={() => onPick(server)}
                  className="rounded-md bg-accent px-2.5 py-1.5 text-[0.6875rem] font-medium text-on-accent transition-colors hover:bg-accent-hover"
                >
                  Use this
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
