/**
 * The Reklu mark.
 *
 * Four nodes converging on one — the product's actual thesis (many models and
 * tools, one workspace) rather than decoration. Drawn as inline SVG so it stays
 * crisp, themeable, and free of a network request.
 */
export function LogoMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Three inputs */}
      <circle cx="4.5" cy="5" r="2" className="fill-text-muted" />
      <circle cx="4.5" cy="12" r="2" className="fill-text-muted" />
      <circle cx="4.5" cy="19" r="2" className="fill-text-muted" />
      {/* Convergence paths */}
      <path
        d="M6.5 5C11 5 12 9 12 12M6.5 12h5.5M6.5 19C11 19 12 15 12 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="text-border-strong"
      />
      {/* The single output */}
      <circle cx="17.5" cy="12" r="4" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-text">Reklu</span>
    </span>
  );
}
