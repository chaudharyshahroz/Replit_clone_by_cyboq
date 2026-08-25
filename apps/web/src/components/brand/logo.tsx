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
 * Built from four things measured off the artwork — the peak, the outermost
 * corner of each arm, how far the underside rises at the axis, and how blunt
 * the arm ends are — because three different things happen at the three
 * corners and no single stroke setting produces all of them:
 *
 *   - the peak is softly rounded, not mitred to a spike;
 *   - the arms taper and end blunt, capped by a small arc;
 *   - the underside is one smooth curve running from cap to cap.
 *
 * The arm ends are thin on purpose. Adjacent arrowheads pass within a few units
 * of each other at the diagonals, and thickening the ends closes that gap — at
 * which point the four shapes fuse into a solid diamond with a ring cut out of
 * it, which is what several earlier attempts produced.
 */
export const ARROWHEAD =
  'M34 27 L47.5 10.12 Q50 7 52.5 10.12 L66 27 ' +
  'A3 3 0 0 1 61.31 30.75 ' +
  'Q50 16.05 38.69 30.75 ' +
  'A3 3 0 0 1 34 27 Z';

const CENTRE_RADIUS = 13.8;
const SATELLITE_RADIUS = 5.4;

const SATELLITES = [
  [22.6, 23.6],
  [77.4, 23.6],
  [22.6, 76.4],
  [77.4, 76.4],
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
