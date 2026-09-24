import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useManualSync } from "@/hooks/useManualSync";
import { isSyncing } from "@/lib/syncLock";
import { tick } from "@/lib/haptics";
import {
  PULL_IDLE,
  isScrollableStyle,
  ownsGestures,
  scrollsByStyle,
  pullBegin,
  pullEnd,
  pullMove,
  type PullState,
} from "@/lib/pullToSync";

/** Touch events, not pointer events: `html` carries `touch-action: pan-x pan-y`, so Chromium cancels a scrolling pointer. */

/** The element that actually scrolls under the finger — `#main` on most routes, a page's own div on the rest. */
function scrollerOf(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : null;
  // An empty or short list scrolls nothing, and that is exactly where someone reaches for the gesture.
  let declared: HTMLElement | null = null;
  while (el) {
    const style = getComputedStyle(el);
    // A pan-and-zoom canvas sits inside a page that never scrolls, so it would otherwise always read as at the top.
    if (ownsGestures(style.touchAction)) return null;
    if (isScrollableStyle(style.overflowY, el.scrollHeight, el.clientHeight)) return el;
    if (!declared && scrollsByStyle(style.overflowY)) declared = el;
    el = el.parentElement;
  }
  // Only once nothing on the path overflows: with nothing scrollable above it, the finger is necessarily at the top.
  return declared;
}

/** One listener set on the document for the whole shell, rather than one per screen that mounts a list. */
export function usePullToSync(): {
  state: PullState;
  syncing: boolean;
  available: boolean;
} {
  const { sync, syncing, available } = useManualSync();
  const { pathname } = useLocation();
  const [state, setState] = useState<PullState>(PULL_IDLE);
  const scroller = useRef<HTMLElement | null>(null);
  // The ref is the gesture's state and the React copy only draws it; a render between two moves is not something to wait on.
  const live = useRef<PullState>(PULL_IDLE);

  // A touch's later events go to its start target, so a screen unmounted mid-pull ends the gesture without a touchend.
  useEffect(() => {
    scroller.current = null;
    live.current = PULL_IDLE;
    setState(PULL_IDLE);
  }, [pathname]);

  useEffect(() => {
    if (!available) return;

    const apply = (next: PullState) => {
      live.current = next;
      setState(next);
    };

    const onStart = (e: TouchEvent) => {
      // A dialog owns the gesture surface while it is up, the same stand-down every screen-level handler makes.
      if (document.querySelector("[data-overlay]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const el = scrollerOf(target);
      if (!el) return;
      scroller.current = el;
      const touch = e.touches[0];
      if (!touch) return;
      apply(
        pullBegin({
          y: touch.clientY,
          scrollTop: el.scrollTop,
          touches: e.touches.length,
          syncing: isSyncing(),
        }),
      );
    };

    const onMove = (e: TouchEvent) => {
      const el = scroller.current;
      const touch = e.touches[0];
      if (!el || !touch || live.current.phase === "idle") return;
      const next = pullMove(live.current, {
        y: touch.clientY,
        scrollTop: el.scrollTop,
        touches: e.touches.length,
        syncing: isSyncing(),
      });
      // Once the pull is ours the browser must not scroll as well; this is why `touchmove` is registered non-passive.
      if (next.phase === "pulling" || next.phase === "ready") e.preventDefault();
      // The moment the pull arms is the one a finger should feel; the release itself is visible.
      if (next.phase === "ready" && live.current.phase !== "ready") tick();
      apply(next);
    };

    const onEnd = () => {
      const { next, sync: fire } = pullEnd(live.current);
      scroller.current = null;
      apply(next);
      if (fire) void sync();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [available, sync]);

  return { state, syncing, available };
}
