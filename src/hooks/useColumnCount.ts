import { useEffect, useState, type RefObject } from "react";

/** Counts the pixel tracks of a computed `grid-template-columns`; an unresolved specified value falls back to one column. */
export function parseColumnCount(tracks: string): number {
  const parts = tracks.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 1;
  if (!parts.every((p) => /^-?[\d.]+px$/.test(p))) return 1;
  return parts.length;
}

/** Reads the browser's resolved `grid-template-columns` rather than recomputing the CSS in JS, so it cannot drift. */
export function useColumnCount(
  ref: RefObject<HTMLElement | null>,
  /** Re-measure whenever this changes; a `ResizeObserver` cannot see `--cover-cols` re-flowing tracks at the same width. */
  watch?: unknown,
): number {
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
  }, [ref, watch]);

  return columns;
}
