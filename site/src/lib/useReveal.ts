import { useEffect, useRef } from "react";

/**
 * Marks an element `data-revealed` the first time it scrolls into view. The
 * stylesheet does the rest with the app's own `riseIn` keyframes, and only
 * where JavaScript is present and motion is welcome — without either, the
 * element is simply visible. One observer per element is cheap at this
 * scale, and it disconnects after firing.
 */
export function useReveal<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.setAttribute("data-revealed", "");
      return;
    }
    // A block taller than most of the viewport can never show `threshold` of
    // itself at once, so for those any intersection counts.
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some(
          (e) =>
            e.isIntersecting &&
            (e.intersectionRatio >= threshold || e.boundingClientRect.height > window.innerHeight * 0.8),
        );
        if (hit) {
          el.setAttribute("data-revealed", "");
          io.disconnect();
        }
      },
      { threshold: [0, threshold], rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}
