/**
 * What is selected in the preview, shared with the composer.
 *
 * The preview and the chat are two panes of one screen but two React trees:
 * the workspace renders the frame on the right, the brief panel renders the
 * composer on the left, and neither is an ancestor of the other. Selecting a
 * heading has to appear as a chip above the box you are about to type in, so
 * the selection lives beside both of them rather than inside either.
 *
 * A module-level store rather than a context, because the common parent is a
 * server component — there is no client boundary high enough to hold a
 * provider without making the whole page a client tree.
 */
import { useSyncExternalStore } from 'react';

export interface PreviewSelection {
  /** The `data-reklu-id` of the picked element. */
  readonly elementId: string;
  /** Its tag, for a label a person can read: "header selected". */
  readonly tag: string;
  /** Set only by the text tool: the replacement the person typed in place. */
  readonly text?: string;
}

let current: PreviewSelection | null = null;
const listeners = new Set<() => void>();

export function setPreviewSelection(selection: PreviewSelection | null): void {
  current = selection;
  for (const listener of listeners) listener();
}

export function usePreviewSelection(): PreviewSelection | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    /* Nothing is selected during a server render; the frame has not run yet. */
    () => null,
  );
}
