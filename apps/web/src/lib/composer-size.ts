/**
 * How tall the composer should be for the text it holds.
 *
 * Split out of the resize effect so the ceiling can actually be tested: jsdom
 * reports every scrollHeight as 0, so a test driving the real textarea passes
 * whether or not the cap exists. Given numbers directly, the rule is checkable.
 */
export interface ComposerSize {
  readonly height: number;
  /** Scroll once the text passes the ceiling, rather than growing further. */
  readonly overflowY: 'auto' | 'hidden';
}

/** Lines of text the composer may grow to before it starts scrolling. */
export const MAX_COMPOSER_LINES = 3;

export function composerSize(input: {
  readonly scrollHeight: number;
  readonly lineHeight: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}): ComposerSize {
  const padding = input.paddingTop + input.paddingBottom;
  const maxHeight = input.lineHeight * MAX_COMPOSER_LINES + padding;

  return {
    height: Math.min(input.scrollHeight, maxHeight),
    overflowY: input.scrollHeight > maxHeight ? 'auto' : 'hidden',
  };
}
