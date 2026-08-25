/**
 * The Reklu mark.
 *
 * Four arrowheads pointing outward from a single centre, with four satellites
 * in the gaps between them: many models and tools, one workspace. Drawn as
 * inline SVG rather than loaded as a file so it stays crisp at every size,
 * costs no network request, and cannot arrive after the page it belongs to.
 */

/**
 * The brand orange, written out rather than taken from the theme.
 *
 * A logo is the brand's colour, not the interface's. Reading it from the accent
 * token would make the mark change hue with the user's colour scheme — two
 * different logos, which is one more than a brand gets to have. This one holds
 * its contrast on both grounds.
 */
export const BRAND_ORANGE = '#FF4A0D';

/**
 * One arrowhead, pointing up. The other three are this one rotated.
 *
 * Three different things happen at its three corners, which is why it is a
 * hand-built path rather than a stroked line:
 *
 *   - the point stays sharp, as a mitred join would leave it;
 *   - the two arm ends are blunt, capped by a semicircle;
 *   - the inner edge is one smooth curve from cap to cap.
 *
 * A stroked centreline gives the first two for free and cannot give the third:
 * offsetting a mitred corner inward produces a second sharp corner facing the
 * middle of the mark, and the artwork has a curve there. That mismatch was the
 * last thing wrong with this shape after several attempts that got the outline
 * right and the corners wrong.
 */
export const ARROWHEAD =
  'M34.34 21.89 L50 7.93 L65.66 21.89 ' +
  'A5.5 5.5 0 0 1 58.34 30.11 ' +
  'Q50 15.23 41.66 30.11 ' +
  'A5.5 5.5 0 0 1 34.34 21.89 Z';

const CENTRE_RADIUS = 13.8;
const SATELLITE_RADIUS = 5.4;

const SATELLITES = [
  [22.5, 22.5],
  [77.5, 22.5],
  [22.5, 77.5],
  [77.5, 77.5],
] as const;

/** The mark's paths, shared by the component and the favicon. */
export function markBody(color: string): string {
  const arrowheads = [0, 90, 180, 270]
    .map((angle) => `<path d="${ARROWHEAD}" transform="rotate(${angle} 50 50)"/>`)
    .join('');
  const satellites = SATELLITES.map(
    ([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${SATELLITE_RADIUS}"/>`,
  ).join('');

  return (
    `<g fill="${color}">${arrowheads}` +
    `<circle cx="50" cy="50" r="${CENTRE_RADIUS}"/>${satellites}</g>`
  );
}

export function LogoMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill={BRAND_ORANGE}
    >
      {[0, 90, 180, 270].map((angle) => (
        <path key={angle} d={ARROWHEAD} transform={`rotate(${angle} 50 50)`} />
      ))}

      <circle cx="50" cy="50" r={CENTRE_RADIUS} />

      {SATELLITES.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={SATELLITE_RADIUS} />
      ))}
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
