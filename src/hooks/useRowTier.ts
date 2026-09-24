import { useEffect, useState, type RefObject } from "react";
import { tierForWidth, type Tier } from "@/components/list/columns";

/** Which set of list columns fits the measured element width; a viewport breakpoint cannot see the sidebar or padding. */
export function useRowTier(
  ref: RefObject<HTMLElement | null>,
  manga: boolean,
  /** False for the text-only list, which fits more columns in the same width. */
  cover = true,
): Tier {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Seed from the current width so the first paint is already right rather than briefly compact.
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  // Until measured, the narrow set: it fits everywhere, so the first frame can never overflow.
  return width === 0 ? "compact" : tierForWidth(width, manga, cover);
}
