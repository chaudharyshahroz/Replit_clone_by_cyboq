interface Point {
  readonly day: string;
  readonly costUsd: number;
}

/**
 * Daily provider spend as bars.
 *
 * Bars rather than a line: spend is a quantity per day, not a continuous
 * value, and a line between two days implies a rate that was never measured.
 */
export function CostChart({ points }: { points: readonly Point[] }) {
  const max = Math.max(0.000001, ...points.map((point) => point.costUsd));
  const total = points.reduce((sum, point) => sum + point.costUsd, 0);

  if (total === 0) {
    return <p className="text-xs text-text-muted">No provider spend recorded yet.</p>;
  }

  return (
    <figure className="m-0">
      <div
        className="flex h-32 items-end gap-0.5"
        role="img"
        aria-label={`Daily provider spend over ${points.length} days, peak $${max.toFixed(4)}.`}
      >
        {points.map((point) => (
          <div
            key={point.day}
            title={`${point.day} · $${point.costUsd.toFixed(4)}`}
            className="min-w-0 flex-1 rounded-t bg-accent/70"
            // A day with real spend keeps a visible sliver rather than vanishing.
            style={{ height: `${Math.max(point.costUsd > 0 ? 2 : 0, (point.costUsd / max) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-[0.6875rem] text-text-muted">
        <span>{points[0]?.day}</span>
        <span>peak ${max.toFixed(4)}/day</span>
        <span>{points[points.length - 1]?.day}</span>
      </figcaption>
    </figure>
  );
}
