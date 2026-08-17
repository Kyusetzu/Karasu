import { useEffect, useRef, useState } from "react";
import { isTyping } from "@/components/shell/KeyboardSheet";
import { nextFocusGrouped } from "@/lib/formatGroups";
import { nextFocus, ownsKeyboard, type Move } from "@/lib/roving";

/**
 * Arrow-key movement over a card grid, for the screens that are one.
 *
 * `MediaList` grew this behaviour inline, entangled with selection mode, the
 * bulk bar and the entry editor — none of which the discovery grids have. This
 * is the same movement (`nextFocus`) under the same ownership rule
 * (`ownsKeyboard`) with none of that, so the two mechanisms cannot drift on the
 * part that matters: when a screen-level handler is allowed to act at all.
 *
 * **Not applied to every grid-shaped screen**, deliberately. Calendar is a
 * schedule rather than a grid, LocalLibrary is rows, and Franchise is a
 * pan-and-zoom canvas where arrow keys already mean *move the viewport* — so on
 * all three, this would be taking a key away from something that already uses
 * it. Seasonal and Search are the two that are genuinely a wall of cards.
 *
 * `columns` comes from `useColumnCount`, which reads the browser's resolved
 * `grid-template-columns` — recomputing the CSS in JS is the thing that gets
 * this wrong at a breakpoint.
 */
export function useGridRoving({
  count,
  columns,
  onOpen,
  enabled = true,
  sections,
}: {
  count: number;
  columns: number;
  /** Enter on the focused card. */
  onOpen: (index: number) => void;
  enabled?: boolean;
  /**
   * Item counts per visual section, when the grid is split into several — as
   * Seasonal is, by format.
   *
   * Without it, movement treats the results as one uniform rectangle, so "down"
   * from a section's ragged last row lands at the wrong offset in the next one
   * and can skip a whole row on the way. Omit for a single grid, which is what
   * Search still is.
   */
  sections?: readonly number[];
}) {
  const [focus, setFocus] = useState<number | null>(null);
  // Read through a ref so the listener can stay mounted for the life of the
  // screen: re-registering it on every focus change would be a subscription
  // churning once per keypress.
  const state = useRef({ focus, count, columns, onOpen, sections });
  state.current = { focus, count, columns, onOpen, sections };

  // A result set that shrank under the cursor — a filter typed, a page
  // changed — must not leave the focus pointing past the end.
  useEffect(() => {
    setFocus((f) => (f === null || f < count ? f : count > 0 ? count - 1 : null));
  }, [count]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // The same three guards `MediaList` uses, in the same order: a text
      // field owns the keyboard while the caret is in one, an overlay owns it
      // while it is up, and any other focused control owns it too — otherwise
      // Enter here would fire against a card while cancelling the button the
      // user actually pressed.
      if (isTyping() || document.querySelector("[data-overlay]")) return;
      if (!ownsKeyboard(document.activeElement, document.body, null)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const {
        focus: at,
        count: n,
        columns: cols,
        onOpen: open,
        sections: parts,
      } = state.current;
      if (n === 0) return;

      const move = (direction: Move) => {
        e.preventDefault();
        const next = parts?.length
          ? nextFocusGrouped(at, direction, cols, parts)
          : nextFocus(at, direction, cols, n);
        if (next !== null) setFocus(next);
      };

      switch (e.key) {
        case "ArrowRight":
          return move("right");
        case "ArrowLeft":
          return move("left");
        case "ArrowDown":
          return move("down");
        case "ArrowUp":
          return move("up");
        case "Escape":
          return setFocus(null);
        case "Enter":
          if (at === null) return;
          e.preventDefault();
          return open(at);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  return { focus, setFocus };
}
