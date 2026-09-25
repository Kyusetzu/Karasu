import { useEffect, useState, type RefObject } from "react";

/** The measured box of an element, 0 × 0 until measured; `useElementWidth` for callers that only need the width. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    // Seeded from the current box so the first paint after mount is already right.
    set(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) set(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
