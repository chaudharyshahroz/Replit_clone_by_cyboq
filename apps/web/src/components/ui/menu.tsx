'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * A small popover menu.
 *
 * Built here rather than pulled in as a dependency because the product needs
 * exactly one interaction: a button that reveals a short list of actions. What
 * it does owe the user is the behaviour people expect of a menu — Escape
 * closes it, a click outside closes it, focus returns to the trigger, and the
 * trigger reports its own state to assistive technology.
 */
export interface MenuProps {
  /** Rendered inside the trigger button. */
  readonly trigger: ReactNode;
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
  readonly triggerClassName?: string;
  /** Which corner the panel grows from. */
  readonly align?: 'left' | 'right';
  readonly side?: 'top' | 'bottom';
  readonly panelClassName?: string;
}

export function Menu({
  trigger,
  label,
  children,
  triggerClassName = '',
  align = 'left',
  side = 'bottom',
  panelClassName = '',
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>();

  /**
   * The panel is rendered into <body>, not beside its trigger.
   *
   * Positioned absolutely it was clipped by the first ancestor with
   * `overflow: auto` — which, for the chat list in the sidebar, is the
   * scrolling panel the menu lives in. The menu appeared half-cut with the
   * row behind it painting over the top. No z-index fixes that: a clipped
   * child cannot escape its scroll container.
   */
  const place = useCallback((): void => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor) return;

    const width = panel?.width ?? 208;
    const height = panel?.height ?? 0;
    const GAP = 6;
    const MARGIN = 8;

    let left = align === 'right' ? anchor.right - width : anchor.left;
    let top = side === 'top' ? anchor.top - height - GAP : anchor.bottom + GAP;

    // Keep it on screen: a menu opened near an edge should slide back into
    // view rather than disappear past it.
    left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
    if (top + height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, anchor.top - height - GAP);
    }
    top = Math.max(MARGIN, top);

    setPosition({ top, left });
  }, [align, side]);

  // Before paint, so the panel never shows at the wrong place first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const close = (): void => {
    setOpen(false);
    // Returning focus is what stops a keyboard user being dropped at the top
    // of the document every time they dismiss a menu.
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    /**
     * `mousedown`, not `click`: a menu item that navigates or submits would
     * otherwise unmount before its own click resolved.
     */
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      // The panel is no longer a descendant of the root, so it has to be
      // checked separately or clicking inside the menu would dismiss it.
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    /*
     * `capture: true` catches scrolling of any ancestor, not just the window —
     * a panel pinned to <body> would otherwise stay behind while the list it
     * belongs to scrolls away underneath it.
     */
    const onReflow = (): void => place();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="menu"
              aria-label={label}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                // Hidden until measured, so it cannot flash at 0,0.
                visibility: position ? 'visible' : 'hidden',
              }}
              className={`fixed z-50 min-w-48 rounded-xl border border-border-strong bg-surface-raised p-1 shadow-2xl shadow-black/50 ${panelClassName}`}
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** One action inside a Menu. */
export function MenuItem({
  onSelect,
  children,
  tone = 'default',
  disabled = false,
}: {
  readonly onSelect: () => void;
  readonly children: ReactNode;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'danger'
          ? 'text-danger hover:bg-danger/10'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A menu item that navigates.
 *
 * Separate from MenuItem because that one is a <button>, and an anchor nested
 * inside a button is invalid — browsers recover from it unpredictably and
 * screen readers announce it as one confused control.
 */
export function MenuLink({
  href,
  onSelect,
  children,
}: {
  readonly href: string;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
    >
      {children}
    </Link>
  );
}

/** A labelled divider, for grouping items that are not alike. */
export function MenuSeparator({ label }: { readonly label?: string }) {
  if (label) {
    return (
      <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
    );
  }
  return <div role="separator" className="my-1 h-px bg-border" />;
}
