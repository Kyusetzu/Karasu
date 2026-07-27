import { useEffect, useState, type RefObject } from "react";

/**
 * Column count from a computed `grid-template-columns` value.
 *
 * For a laid-out grid the browser resolves the track list to used pixel
 * values — `"150px 150px 150px"` — so counting the tokens gives the answer.
 * For an element that has not been laid out (hidden, detached, or measured too
 * early) it hands back the *specified* value instead, e.g.
 * `"repeat(auto-fill, minmax(9.375rem, 1fr))"`, which would count as two
 * columns and quietly halve the grid. Anything that is not a plain pixel track
 * therefore falls back to a single column, which is always safe to render.
 */
export function parseColumnCount(tracks: string): number {
  const parts = tracks.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 1;
  if (!parts.every((p) => /^-?[\d.]+px$/.test(p))) return 1;
  return parts.length;
}

/**
 * How many columns a CSS grid has actually resolved to.
 *
 * Virtualizing a grid means chunking the items into rows by hand, which needs
 * a column count — but the layout is `repeat(auto-fill, minmax(…))`, so the
 * count depends on the width, on the root font size (Karasu scales that from
 * the Windows text-size setting) and on the breakpoint. Rather than duplicating
 * those constants in JS and letting them drift from `index.css`, ask the
 * browser what it decided.
 *
 * `auto-fill` keeps empty tracks, so this reads correctly even when the element
 * being measured currently holds fewer items than there are columns.
 */
export function useColumnCount(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const count = parseColumnCount(getComputedStyle(el).gridTemplateColumns);
      setColumns((prev) => (prev === count ? prev : count));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
}
