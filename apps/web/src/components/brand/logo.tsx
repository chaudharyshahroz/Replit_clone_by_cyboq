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
 * Two straight edges up to the point, and a curve scooped out underneath, so
 * the shape reads as an arrowhead rather than a triangle. The geometry is
 * fixed here rather than computed: it was arrived at by drawing it and looking
 * at it, and a formula would only obscure that.
 */
export const ARROWHEAD = 'M32.1 27.1 L50 6 L67.9 27.1 Q50 7.1 32.1 27.1 Z';

const SATELLITES = [
  [23, 23],
  [77, 23],
  [23, 77],
  [77, 77],
] as const;

/** The mark's paths, shared by the component and the favicon. */
export function markBody(color: string): string {
  const arrowheads = [0, 90, 180, 270]
    .map((angle) => `<path d="${ARROWHEAD}" transform="rotate(${angle} 50 50)"/>`)
    .join('');
  const satellites = SATELLITES.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="6"/>`).join('');

  return (
    `<g fill="${color}">` +
    /*
     * Stroked in its own fill colour purely to round the corners. A filled path
     * has no join to soften, and every corner of this mark is rounded — drawing
     * each as an explicit arc would quadruple the path for a result the
     * renderer produces from one attribute.
     */
    `<g stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">` +
    `${arrowheads}</g>` +
    `<circle cx="50" cy="50" r="15"/>${satellites}</g>`
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
      <g
        stroke={BRAND_ORANGE}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {[0, 90, 180, 270].map((angle) => (
          <path key={angle} d={ARROWHEAD} transform={`rotate(${angle} 50 50)`} />
        ))}
      </g>

      <circle cx="50" cy="50" r="15" />

      {SATELLITES.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" />
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
