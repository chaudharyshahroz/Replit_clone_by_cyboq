'use client';

import { useEffect, useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, Globe, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import {
  checkDomainAction,
  publicationStateAction,
  publishAction,
  removeDomainAction,
  setDomainAction,
  unpublishAction,
  type PublishState,
} from '@/app/(app)/build/actions';

/**
 * Putting a site on the internet, and pointing a domain at it.
 *
 * Every state here is one the server actually reported. A domain that has been
 * entered but whose DNS has not arrived says exactly that and shows the record
 * to create — it does not claim to be live, because the certificate would not
 * exist yet and the visitor would meet a browser warning rather than a site.
 */
export function PublishPanel({ buildId, hasFiles }: { buildId: string; hasFiles: boolean }) {
  const [state, setState] = useState<PublishState | null>(null);
  const [domain, setDomain] = useState('');
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  /* What is live right now, read on arrival rather than assumed. */
  useEffect(() => {
    void publicationStateAction(buildId).then(setState);
  }, [buildId]);

  const run = (label: string, action: () => Promise<PublishState>) => {
    setBusy(label);
    startTransition(async () => {
      setState(await action());
      setBusy(null);
    });
  };

  const live = state?.status === 'live';
  const domainLive = state?.domainStatus === 'live';
  const working = pending || busy !== null;

  /* Publishing is unavailable on this instance; say which variable is missing. */
  if (state?.error && !state.status) {
    return (
      <section className="rounded-xl border border-border bg-surface/40 p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <Globe className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Publish
        </h2>
        <p className="mt-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {state.error}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-text">
        <Globe className="h-4 w-4 text-accent" strokeWidth={1.75} />
        Publish
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
        Put this app on the internet at its own address, hosted by Reklu. Add your own domain
        when you have one.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run('publish', () => publishAction(buildId))}
          disabled={working || !hasFiles}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'publish' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {busy === 'publish' ? 'Publishing…' : live ? 'Publish the latest version' : 'Publish'}
        </button>

        {live ? (
          <button
            type="button"
            onClick={() => run('unpublish', () => unpublishAction(buildId))}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Take it down
          </button>
        ) : null}
      </div>

      {!hasFiles ? (
        <p className="mt-3 text-xs text-text-muted">
          Generate the app first — there is nothing to publish yet.
        </p>
      ) : null}

      {busy === 'publish' ? (
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          Installing, building for production and starting the server. This takes a few minutes,
          and the steps appear in the chat.
        </p>
      ) : null}

      {state?.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-text"
        >
          {state.error}
        </p>
      ) : null}

      {live && state.url ? (
        <div role="status" className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Live
          </p>
          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
          >
            {state.url.replace('https://', '')}
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </a>
        </div>
      ) : null}

      {state?.status === 'failed' && state.detail ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-text"
        >
          {state.detail}
        </p>
      ) : null}

      {/* ---- The custom domain ---- */}
      {live ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-text">Your own domain</h3>

          {state.customDomain ? (
            <>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text">
                <span className="font-medium">{state.customDomain}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[0.6875rem] ${
                    domainLive
                      ? 'bg-success/15 text-success'
                      : 'bg-warning/15 text-warning'
                  }`}
                >
                  {domainLive ? 'live' : 'waiting for DNS'}
                </span>
              </p>

              {!domainLive && state.dns ? (
                <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <p className="text-xs leading-relaxed text-text-secondary">
                    Add this record at whoever manages {state.customDomain}, then check again.
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[0.6875rem]">
                    <dt className="text-text-muted">Type</dt>
                    <dd className="text-text">{state.dns.type}</dd>
                    <dt className="text-text-muted">Name</dt>
                    <dd className="text-text">{state.dns.name}</dd>
                    <dt className="text-text-muted">Value</dt>
                    <dd className="break-all text-text">{state.dns.value}</dd>
                  </dl>
                  {/*
                    Said plainly rather than hidden behind a spinner. DNS takes
                    as long as it takes, and a person who does not know that
                    reads a correct "not yet" as a broken feature.
                  */}
                  <p className="mt-2 text-[0.6875rem] leading-relaxed text-text-muted">
                    DNS changes can take anywhere from a few minutes to a few hours to spread.
                  </p>
                  {state.domainDetail ? (
                    <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-warning">
                      {state.domainDetail}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {!domainLive ? (
                  <button
                    type="button"
                    onClick={() => run('check', () => checkDomainAction(buildId))}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.6875rem] font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-50"
                  >
                    {busy === 'check' ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    ) : (
                      <RefreshCw className="h-3 w-3" strokeWidth={2} />
                    )}
                    {busy === 'check' ? 'Checking…' : 'Check DNS'}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => run('remove', () => removeDomainAction(buildId))}
                  disabled={working}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[0.6875rem] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2} />
                  Remove
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const entered = domain.trim();
                if (!entered) return;
                run('domain', () => setDomainAction(buildId, entered));
                setDomain('');
              }}
              className="mt-2 flex flex-wrap gap-2"
            >
              <label htmlFor="custom-domain" className="sr-only">
                Your domain
              </label>
              <input
                id="custom-domain"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="example.com"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
              <button
                type="submit"
                disabled={working || !domain.trim()}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.6875rem] font-medium text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
              >
                Add
              </button>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
