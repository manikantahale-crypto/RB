/**
 * The three-dot menu on a list row.
 *
 * WHY A MENU RATHER THAN MORE BUTTONS.
 *
 * A row whose every action is a visible control is a row you read instead of
 * scan, and the registry's job is finding a workflow among three hundred. The
 * row itself carries the one thing people want most — see what it has been
 * doing — and everything else moves behind one affordance that is always in
 * the same place.
 *
 * WHAT IT HAS TO GET RIGHT, because a half-built menu is worse than buttons:
 *
 *   * Clicking it must not also trigger the row. The row is clickable, so
 *     every handler in here stops propagation — without that, opening the menu
 *     navigates away from the row you were opening it on.
 *   * Escape closes it, and focus goes back to the button. Somebody who opens
 *     this by keyboard has to be able to leave without using the mouse.
 *   * Clicking anywhere else closes it. A menu that stays open while you work
 *     elsewhere on the page ends up being dismissed by navigating away.
 *   * Arrow keys move between items, which is what a `menu` role promises. A
 *     role that lies about its keyboard support is worse than no role.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  /** Shown greyed, with this as the reason. */
  disabledReason?: string | null;
};

export function RowMenu({
  items,
  label,
  testId,
}: {
  items: RowMenuItem[];
  /** Announced to screen readers — "More actions for syntra.jd.workflow". */
  label: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    // `mousedown` rather than `click`: a click that lands on another row would
    // otherwise open that row before this menu had closed.
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Opening puts focus on the first item, or the menu is open and nothing on
  // the keyboard reaches it.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + items.length) % items.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div
      className="row-menu"
      ref={wrapRef}
      // The row below is clickable. Nothing that happens inside this menu is
      // also a click on the row.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        ref={buttonRef}
        className="row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {/* Three dots, drawn rather than typed: the character renders at wildly
            different sizes across the fonts this runs in. */}
        <span className="row-menu-dot" aria-hidden="true" />
        <span className="row-menu-dot" aria-hidden="true" />
        <span className="row-menu-dot" aria-hidden="true" />
      </button>

      {open ? (
        <div className="row-menu-list" role="menu" aria-label={label}>
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className="row-menu-item"
              disabled={Boolean(item.disabledReason)}
              title={item.disabledReason ?? undefined}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
            >
              {item.label}
              {item.disabledReason ? (
                <span className="row-menu-why">{item.disabledReason}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
