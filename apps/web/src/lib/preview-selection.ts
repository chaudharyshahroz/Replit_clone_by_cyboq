/**
 * What is pointed at in the preview, shared with the composer.
 *
 * The preview and the chat are two panes of one screen but two React trees: the
 * workspace renders the frame on the right, the brief panel renders the composer
 * on the left, and neither is an ancestor of the other. What the tools pick has
 * to appear as a chip above the box you are about to type in, so it lives beside
 * both of them rather than inside either.
 *
 * A module-level store rather than a context, because the common parent is a
 * server component — there is no client boundary high enough to hold a provider
 * without making the whole page a client tree.
 */
import { useSyncExternalStore } from 'react';

/** One element, picked with the arrow or circled with the pencil. */
export interface PickedElement {
  /** The `data-reklu-id` of the element. */
  readonly elementId: string;
  /** Its tag, for a label a person can read: "header selected". */
  readonly tag: string;
}

/** One retyped piece of text, not yet sent. */
export interface TextChange extends PickedElement {
  readonly text: string;
}

export interface PreviewEdits {
  readonly selection?: PickedElement;
  /**
   * Retyped text, gathered rather than sent one at a time.
   *
   * Fixing a heading and the paragraph under it is one thought and should be
   * one request — sending on every keystroke-and-blur would start a build per
   * word, each one rewriting files the next is about to rewrite again.
   */
  readonly textChanges: readonly TextChange[];
  /** What a drawn circle enclosed. */
  readonly annotation?: PickedElement;
}

const EMPTY: PreviewEdits = { textChanges: [] };

let current: PreviewEdits = EMPTY;
const listeners = new Set<() => void>();

function publish(next: PreviewEdits): void {
  current = next;
  for (const listener of listeners) listener();
}

export function setPreviewSelection(selection: PickedElement | null): void {
  publish({ ...current, selection: selection ?? undefined });
}

export function setPreviewAnnotation(annotation: PickedElement | null): void {
  publish({ ...current, annotation: annotation ?? undefined });
}

export function setPreviewTextChanges(changes: readonly TextChange[]): void {
  publish({ ...current, textChanges: changes });
}

/** Put everything down — after sending, or when the person clears it. */
export function clearPreviewEdits(): void {
  publish(EMPTY);
}

export function hasPreviewEdits(edits: PreviewEdits): boolean {
  return Boolean(edits.selection) || Boolean(edits.annotation) || edits.textChanges.length > 0;
}

export function usePreviewEdits(): PreviewEdits {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    /* Nothing is picked during a server render; the frame has not run yet. */
    () => EMPTY,
  );
}
