/**
 * Light and dark, and the third option that is neither.
 *
 * Reklu was dark only. The light tokens existed and were complete — declared
 * as their own set rather than patched into the dark ones — and nothing ever
 * set them, so the work here is a switch and not a palette.
 *
 * Three settings, because two is not enough: somebody whose machine changes at
 * sunset wants Reklu to change with it, and somebody who has chosen wants their
 * choice to survive that. `system` is the default, since a preference already
 * expressed elsewhere should not have to be expressed again.
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'reklu.theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Applied before the first paint, or the page flashes the wrong one.
 *
 * Inlined into the document head as a string rather than run from a component,
 * because a component runs after React has hydrated and the flash has already
 * happened. It is deliberately tiny and deliberately defensive: a browser with
 * storage disabled throws on read, and a theme script that throws leaves the
 * page unstyled.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_KEY}');
    var theme = stored === 'light' || stored === 'dark' ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (error) {
    /* Storage refused. Dark is the default and the page still renders. */
  }
})();
`.trim();

/** What the document should show for a setting, resolving `system` now. */
export function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Put a setting into effect.
 *
 * The attribute is removed rather than set to `dark`, because the dark tokens
 * live on `:root` — an explicit `data-theme="dark"` would be a second way of
 * saying the same thing, and two ways to say one thing is how they drift.
 */
export function apply(theme: Theme): void {
  const root = document.documentElement;
  if (resolve(theme) === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

export function readStored(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    /* A private window, or storage turned off. Neither is an error. */
    return 'system';
  }
}

export function store(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* The setting will not survive a reload, and the page still works. */
  }
}
