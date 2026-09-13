import { useEffect, useRef, useState } from "react";
import { isTyping } from "@/components/shell/KeyboardSheet";
import { nextFocusGrouped } from "@/lib/formatGroups";
import { nextFocus, ownsKeyboard, type Move } from "@/lib/roving";

/** Arrow keys over a wall of cards via `MediaList`'s roving; not for Franchise, whose arrows already pan. */
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
  /** Item counts per visual section; without it "down" from a ragged last row lands at the wrong offset in the next. */
  sections?: readonly number[];
}) {
  const [focus, setFocus] = useState<number | null>(null);
  // Read through a ref so the listener stays mounted for the life of the screen instead of re-registering per keypress.
  const state = useRef({ focus, count, columns, onOpen, sections });
  state.current = { focus, count, columns, onOpen, sections };

  // A result set that shrank under the cursor must not leave the focus pointing past the end.
  useEffect(() => {
    setFocus((f) => (f === null || f < count ? f : count > 0 ? count - 1 : null));
  }, [count]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // `MediaList`'s three guards in the same order: a text field, an overlay or any focused control owns the keyboard.
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
