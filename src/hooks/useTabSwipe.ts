import { useEffect, useRef, type RefObject } from "react";
import { isEdgeStart, swipeAxis, swipeOffset, tabSwipe } from "@/lib/navSwipe";
import { ownsGestures } from "@/lib/pullToSync";
import { motionDuration } from "@/lib/motion";

/** How long the list takes to settle back, or to slide the next tab in. */
const SETTLE_MS = 220;
/** Where the next tab starts its slide from, on the side the finger came from. */
const ENTER_PX = 48;

/** A field, a canvas that pans, or a row that scrolls sideways under the finger handles the drag itself. */
function claimedSideways(target: EventTarget | null, surface: HTMLElement): boolean {
  const start = target instanceof HTMLElement ? target : null;
  if (start?.closest("input, textarea, select, [contenteditable='true']")) return true;
  for (let el = start; el && el !== surface; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (ownsGestures(style.touchAction)) return true;
    const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll";
    if (scrollsX && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

/** Touch events, like the pull: `html` allows `pan-x`, so Chromium would cancel a pointer the moment it moved sideways. */
export function useTabSwipe({
  surface,
  content,
  enabled,
  canStep,
  onStep,
}: {
  /** Where a swipe may start; listened on directly, so the shell's floating pieces never reach it. */
  surface: RefObject<HTMLElement | null>;
  /** What follows the finger; an ancestor must clip it, or it widens the page. */
  content: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** False past either end, where the list only rubber-bands. */
  canStep: (step: 1 | -1) => boolean;
  onStep: (step: 1 | -1) => void;
}): void {
  // Read through a ref, so the listeners are bound once per surface and still ask about the current tab.
  const latest = useRef({ canStep, onStep });
  latest.current = { canStep, onStep };

  useEffect(() => {
    const el = surface.current;
    if (!enabled || !el) return;
    let start: { x: number; y: number } | null = null;
    let last = { x: 0, y: 0 };
    let axis: "x" | "y" | null = null;

    const paint = (offset: number, ms: number) => {
      const node = content.current;
      if (!node) return;
      node.style.transition = ms ? `transform ${ms}ms var(--ease-out-expo)` : "none";
      node.style.transform = offset ? `translateX(${offset}px)` : "";
    };
    const release = () => {
      const wasSwiping = start !== null && axis === "x";
      start = null;
      axis = null;
      if (wasSwiping) paint(0, motionDuration(SETTLE_MS));
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      axis = null;
      const touch = e.touches[0];
      // One finger, nothing modal over the list, and not from the strips the system's back gesture owns.
      if (!touch || e.touches.length !== 1 || document.querySelector("[data-overlay]")) return;
      if (isEdgeStart(touch.clientX, window.innerWidth) || claimedSideways(e.target, el)) return;
      start = { x: touch.clientX, y: touch.clientY };
      last = start;
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      // A second finger, or a long press whose sheet opened under the finger, ends the swipe where it stands.
      if (!touch || e.touches.length !== 1 || document.querySelector("[data-overlay]")) return release();
      last = { x: touch.clientX, y: touch.clientY };
      const dx = last.x - start.x;
      const dy = last.y - start.y;
      axis ??= swipeAxis(dx, dy);
      if (axis === "y") {
        start = null;
        return;
      }
      if (axis !== "x") return;
      // Ours from the first sideways sample: the page must not pan along with the list.
      e.preventDefault();
      paint(swipeOffset(dx, latest.current.canStep(dx < 0 ? 1 : -1)), 0);
    };

    const onEnd = () => {
      if (!start || axis !== "x") return release();
      const step = tabSwipe({ dx: last.x - start.x, dy: last.y - start.y, width: el.clientWidth });
      start = null;
      axis = null;
      if (step === null || !latest.current.canStep(step)) return paint(0, motionDuration(SETTLE_MS));
      latest.current.onStep(step);
      const ms = motionDuration(SETTLE_MS);
      paint(ms ? step * ENTER_PX : 0, 0);
      // A frame later, so the start position is painted before the slide to rest begins.
      if (ms) requestAnimationFrame(() => paint(0, ms));
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", release);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", release);
      paint(0, 0);
    };
  }, [enabled, surface, content]);
}
