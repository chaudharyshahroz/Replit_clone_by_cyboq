'use client';

import { useActionState, useState } from 'react';
import { ServerDirectory } from './server-directory';
import { Loader2, Plus, X } from 'lucide-react';
import { connectServerAction, type McpFormState } from '@/app/(app)/settings/mcp/actions';

/**
 * Connect an MCP server.
 *
 * The credential field is write-only by design: Reklu stores it encrypted and
 * never renders it back, so there is nothing to leak into a screenshot or a
 * shared session.
 */
export function ConnectServerForm() {
  // Reopened automatically after a failure, so the error and the fields that
  // caused it stay on screen together.
  const [open, setOpen] = useState(false);
  /*
   * Filled from the directory, so picking a server writes into the same fields
   * somebody would otherwise type. Held as state rather than written to the DOM
   * because the inputs are controlled by React the moment this is set.
   */
  const [picked, setPicked] = useState<{ name: string; endpoint: string } | null>(null);
  const [state, action, pending] = useActionState<McpFormState, FormData>(
    connectServerAction,
    {},
  );

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add server
        </button>
        {state.notice ? (
          <p role="status" className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
            {state.notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-border bg-surface/40 p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-medium text-text">Add an MCP server</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded p-1 text-text-muted hover:text-text"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {state.error}
        </p>
      ) : null}

      {/*
        Finding one, for everybody who does not already know an endpoint —
        which was almost everybody, and made this form look like a feature for
        people who had read the protocol spec.
      */}
      <div className="mt-4 rounded-lg border border-border bg-surface/40 p-3">
        <p className="text-xs font-medium text-text">Find a server</p>
        <p className="mt-1 mb-2.5 text-[0.6875rem] leading-relaxed text-text-secondary">
          Searches the MCP registry. Picking one fills the form below; nothing connects until
          you say so.
        </p>
        <ServerDirectory
          onPick={(server) => setPicked({ name: server.title, endpoint: server.url })}
        />
      </div>

      <div className="mt-4 grid gap-4">
        <label className="block">
          <span className="text-xs font-medium text-text">Name</span>
          <input
            key={picked?.endpoint ?? 'name'}
            name="name"
            defaultValue={picked?.name ?? state.submitted?.name}
            placeholder="My tools"
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text">Endpoint URL</span>
          <span className="ml-2 text-[0.6875rem] text-text-muted">Must be reachable over HTTPS.</span>
          <input
            /*
              Keyed on the pick, so choosing a server replaces what is in the
              field. An uncontrolled input ignores a changed defaultValue.
            */
            key={picked?.endpoint ?? 'endpoint'}
            name="endpoint"
            required
            type="url"
            defaultValue={picked?.endpoint ?? state.submitted?.endpoint}
            placeholder="https://example.com/mcp"
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text">Authorization header</span>
          <span className="ml-2 text-[0.6875rem] text-text-muted">Optional. Stored encrypted.</span>
          <input
            name="credential"
            type="password"
            autoComplete="off"
            placeholder="Bearer …"
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-text-muted focus:border-accent"
          />
        </label>
      </div>

      <p className="mt-4 text-[0.6875rem] leading-relaxed text-text-muted">
        Reklu will read the server&rsquo;s tool list and show it to you. Nothing runs
        until you enable a tool and approve its definitions.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
        {pending ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
