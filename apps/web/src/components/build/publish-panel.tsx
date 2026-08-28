'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
  Triangle,
  Wrench,
} from 'lucide-react';
import {
  checkDomainAction,
  fixPublishFailureAction,
  publicationStateAction,
  publishAction,
  publishToVercelAction,
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
  /*
   * Where this build should live. Not remembered across visits: it is a
   * decision about one deploy, and a remembered answer would silently send the
   * next one somewhere the person did not choose today.
   */
  const [target, setTarget] = useState<'reklu' | 'vercel'>('reklu');
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  /* What is live right now, read on arrival rather than assumed. */
  useEffect(() => {
    void publicationStateAction(buildId).then(setState);
  }, [buildId]);

  const run = (label: string, action: () => Promise<PublishState>) => {
    setBusy(label);
    startTransition(async () => {
      const result = await action();
      /*
       * Merged, not replaced. A failed publish answers with an error and
       * nothing else, and replacing the state with it threw away the slug, the
       * domain and the status — so one failure emptied the panel of every
       * control, including the one that would retry.
       */
      setState((previous) => ({ ...previous, ...result }));
      setBusy(null);
    });
  };

  const live = state?.status === 'live';
  const domainLive = state?.domainStatus === 'live';
  const working = pending || busy !== null;

  /*
   * Unavailable on this instance, which is the one case where there is nothing
   * to show but the reason. Keyed on an explicit flag rather than on the
   * absence of a status, because a failed publish also has no status and is not
   * the same thing at all.
   */
  if (state?.configured === false) {
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
        Put this app on the internet. Reklu hosts it at its own address, or it goes to your own
        Vercel account and Reklu stops being involved.
      </p>

      {/*
        Two destinations, offered together rather than one here and one under
        Export. They answer the same question — where does this site live — and
        separating them made the Vercel path look like a developer's escape
        hatch rather than a way to publish.
      */}
      <div
        role="radiogroup"
        aria-label="Where to publish"
        className="mt-3 inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5"
      >
        {(
          [
            ['reklu', 'Reklu', 'Hosted here, with a domain you can point at it'],
            ['vercel', 'Vercel', 'Your account, your bill, your control'],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={target === value}
            title={hint}
            onClick={() => setTarget(value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${
              target === value ? 'bg-surface-raised text-text' : 'text-text-secondary hover:text-text'
            }`}
          >
            {value === 'vercel' ? (
              <Triangle className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Globe className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            run('publish', () =>
              target === 'vercel' ? publishToVercelAction(buildId) : publishAction(buildId),
            )
          }
          disabled={working || !hasFiles}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'publish' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {busy === 'publish'
            ? 'Publishing…'
            : target === 'vercel'
              ? 'Deploy to Vercel'
              : live
                ? 'Publish the latest version'
                : 'Publish'}
        </button>

        {live && target === 'reklu' ? (
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

      {state?.status === 'publishing' && state.url ? (
        <div role="status" className="mt-3 rounded-lg border border-border bg-surface px-3 py-2.5">
          <p className="text-xs leading-relaxed text-text-secondary">
            Vercel is building it. This link answers once that finishes.
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

      {state?.status === 'failed' ? (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3">
          <p role="alert" className="text-xs leading-relaxed text-text">
            The production build failed. It compiled well enough to preview, so this is
            something that only shows up when every page is rendered ahead of time.
          </p>

          {/*
            The build's own output, not a summary of it. Next prints its
            conclusion last and the cause well above — so a tail of the log
            reliably captured "Export encountered errors" and dropped the line
            that said why.
          */}
          {state.buildLog ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-canvas/60 p-2 font-mono text-[0.6875rem] leading-relaxed text-text-secondary">
              {state.buildLog}
            </pre>
          ) : state.detail ? (
            <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-text-secondary">
              {state.detail}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() =>
              run('fix', async () => {
                await fixPublishFailureAction(buildId);
                return publicationStateAction(buildId);
              })
            }
            disabled={working}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1.5 text-[0.6875rem] font-medium text-text transition-colors hover:bg-danger/20 disabled:opacity-50"
          >
            {busy === 'fix' ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Wrench className="h-3 w-3" strokeWidth={2} />
            )}
            {busy === 'fix' ? 'Fixing…' : 'Fix this and try again'}
          </button>
        </div>
      ) : null}

      {/*
        ---- The custom domain ----

        Reklu's own hosting only. A site on Vercel has its domains managed
        there, and offering a second place to set one would be two sources of
        truth for one hostname.

        Shown for any site that has an address, not only one that is currently
        up. It used to appear only while `status === 'live'`, so a publish that
        failed took the whole domain section with it — and the way to reach it
        was to fix the publish first, which is not obvious from a panel that
        simply does not mention domains.
      */}
      {state?.slug && target === 'reklu' ? (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-text">Your own domain</h3>

          {!live ? (
            <p className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-[0.6875rem] leading-relaxed text-text-muted">
              The site is not running at the moment. A domain can be added now; it starts
              answering once the site is published again.
            </p>
          ) : null}

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
