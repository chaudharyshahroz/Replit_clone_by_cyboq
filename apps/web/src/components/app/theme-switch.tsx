'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { apply, readStored, store, type Theme } from '@/lib/theme';

const OPTIONS: readonly { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Choosing light, dark, or whatever the machine is doing.
 *
 * Rendered from state that is only read after mount. The server cannot know
 * what is in somebody's browser storage, so rendering a selected option during
 * the server pass would mean rendering the wrong one and then correcting it —
 * which is a flash of the wrong answer in a control whose entire job is
 * choosing the right one.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readStored());
  }, []);

  /*
   * Follow the machine while the setting is `system`. Without this, a laptop
   * that turns dark at sunset leaves Reklu light until the page is reloaded —
   * which is the one thing somebody choosing `system` was asking not to happen.
   */
  useEffect(() => {
    if (theme !== 'system') return;

    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);
    store(next);
    apply(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          /* Nothing is selected until the stored value has been read. */
          aria-checked={theme === value}
          onClick={() => choose(value)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
            theme === value
              ? 'bg-surface-raised text-text'
              : 'text-text-secondary hover:text-text'
          }`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
