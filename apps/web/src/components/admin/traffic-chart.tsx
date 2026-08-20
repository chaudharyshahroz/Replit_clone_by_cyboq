interface Point {
  readonly day: string;
  readonly signups: number;
  readonly messages: number;
  readonly activeUsers: number;
}

/**
 * Traffic over time, as inline SVG.
 *
 * A server component with no charting library: three series over thirty points
 * does not justify shipping one to the browser, and the CSP forbids external
 * scripts anyway.
 */
export function TrafficChart({ points }: { points: readonly Point[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-text-muted">No activity recorded yet.</p>;
  }

  const width = 720;
  const height = 160;
  const pad = 8;

  const series = [
    { key: 'messages' as const, label: 'Messages', colour: 'var(--color-accent)' },
    { key: 'activeUsers' as const, label: 'Active users', colour: 'var(--color-success)' },
    { key: 'signups' as const, label: 'Sign-ups', colour: 'var(--color-text-muted)' },
  ];

  // One shared scale, so the series stay visually comparable.
  const max = Math.max(1, ...points.flatMap((p) => [p.messages, p.activeUsers, p.signups]));
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;

  const path = (key: (typeof series)[number]['key']): string =>
    points
      .map((point, index) => {
        const x = pad + index * step;
        const y = height - pad - (point[key] / max) * (height - pad * 2);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full min-w-[36rem]"
          role="img"
          aria-label={`Daily messages, active users and sign-ups over the last ${points.length} days. Peak ${max}.`}
        >
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={pad}
              x2={width - pad}
              y1={height - pad - fraction * (height - pad * 2)}
              y2={height - pad - fraction * (height - pad * 2)}
              stroke="currentColor"
              strokeWidth="1"
              className="text-border"
            />
          ))}
          {series.map((entry) => (
            <path
              key={entry.key}
              d={path(entry.key)}
              fill="none"
              stroke={entry.colour}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>

      <figcaption className="mt-3 flex flex-wrap gap-4 text-[0.6875rem] text-text-secondary">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{ background: entry.colour }}
            />
            {entry.label}
          </span>
        ))}
        <span className="text-text-muted">peak {max}/day</span>
      </figcaption>
    </figure>
  );
}
