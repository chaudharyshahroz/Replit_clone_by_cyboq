import { Github } from 'lucide-react';
import { availableSignInProviders } from '@reklu/auth';

/**
 * Google and GitHub sign-in buttons.
 *
 * A provider without credentials renders as a stated fact naming the variables
 * an operator must set — never as a button that fails after the click
 * (spec §25, §111).
 *
 * These are plain links, not form posts: the start route must set a cookie and
 * redirect on the same response, and a top-level navigation is the simplest
 * thing that does that correctly.
 */
export function SocialSignIn({ returnTo }: { readonly returnTo?: string }) {
  const providers = availableSignInProviders();
  const configured = providers.filter((provider) => provider.configured);

  if (configured.length === 0) {
    const names = providers.flatMap((provider) => provider.requiredEnv[0]);
    return (
      <p className="mt-6 rounded-lg border border-border bg-surface/50 p-3 text-xs leading-relaxed text-text-muted">
        Google and GitHub sign-in are not configured on this instance. Set{' '}
        {names.map((name, index) => (
          <span key={name}>
            {index > 0 ? ' or ' : ''}
            <code className="text-text-secondary">{name}</code>
          </span>
        ))}{' '}
        to enable them.
      </p>
    );
  }

  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wider text-text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-4 grid gap-2">
        {configured.map((provider) => (
          <a
            key={provider.key}
            href={`/api/auth/oauth/${provider.key}/start${query}`}
            className="flex items-center justify-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            {provider.key === 'github' ? (
              <Github className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <GoogleMark />
            )}
            Continue with {provider.displayName}
          </a>
        ))}
      </div>

      {/*
        Stated before the click, not after: signing in with a provider whose
        verified address already has a Reklu account joins that account rather
        than creating a second one.
      */}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-text-muted">
        If your provider email already has a Reklu account, you will be signed
        into it.
      </p>
    </div>
  );
}

/** Google's mark. Inline so the button needs no network request. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z"
      />
    </svg>
  );
}
