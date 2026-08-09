import { useEffect, useState, type RefObject } from "react";
import { tierForWidth, type Tier } from "@/components/list/columns";

/**
 * Which set of list columns fits in `ref`'s current width.
 *
 * Measured rather than derived from a viewport breakpoint, because the space a
 * row actually gets is the window minus the sidebar minus the page padding — and
 * a `2xl:` guess would be wrong for anyone running the window at anything other
 * than full screen.
 *
 * A `ResizeObserver` and not a `matchMedia` listener for the same reason: the
 * element's width is the input, so watching the element is watching the thing
 * that decides. One observer for the whole list, not one per row.
 */
export function useRowTier(
  ref: RefObject<HTMLElement | null>,
  manga: boolean,
): Tier {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Seed from the current width: the observer fires on connect in every
    // browser that matters, but reading once means the first paint is already
    // right rather than briefly compact.
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  // Until measured, the narrow set — it fits everywhere, so the first frame can
  // never overflow. Guessing wide and correcting would show a broken row.
  return width === 0 ? "compact" : tierForWidth(width, manga);
}
