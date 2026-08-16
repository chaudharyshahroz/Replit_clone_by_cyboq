'use client';

/**
 * Last-resort boundary: catches failures in the root layout itself, so it must
 * render its own <html>/<body> and must not depend on any app context.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#08080a',
          color: '#f5f5f6',
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: 460, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
            Reklu could not load
          </h1>
          <p style={{ marginTop: 12, lineHeight: 1.6, color: '#a3a3ad', fontSize: 15 }}>
            Something failed before the interface could start. This is on our side, not
            yours.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 16, fontSize: 12, color: '#6e6e7a' }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              height: 40,
              padding: '0 20px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: '#ff6a3d',
              color: '#1a0a04',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Reload Reklu
          </button>
        </main>
      </body>
    </html>
  );
}
