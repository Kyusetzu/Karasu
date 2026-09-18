import { useEffect, useRef, useState } from "react";
import { useManualSync } from "@/hooks/useManualSync";
import { isSyncing } from "@/lib/syncLock";
import {
  PULL_IDLE,
  isScrollableStyle,
  pullBegin,
  pullEnd,
  pullMove,
  type PullState,
} from "@/lib/pullToSync";

/** Touch events, not pointer events: `html` carries `touch-action: pan-y`, so Chromium cancels the pointer once it scrolls. */

/** The element that actually scrolls under the finger — `#main` on most routes, a page's own div on the rest. */
function scrollerOf(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : null;
  while (el) {
    const style = getComputedStyle(el);
    if (isScrollableStyle(style.overflowY, el.scrollHeight, el.clientHeight)) return el;
    el = el.parentElement;
  }
  return null;
}

/** One listener set on the document for the whole shell, rather than one per screen that mounts a list. */
export function usePullToSync(): {
  state: PullState;
  syncing: boolean;
  available: boolean;
} {
  const { sync, syncing, available } = useManualSync();
  const [state, setState] = useState<PullState>(PULL_IDLE);
  const scroller = useRef<HTMLElement | null>(null);
  // The listeners are registered once and read the live state through a ref, the shape `useGridRoving` established.
  const live = useRef(state);
  live.current = state;

  useEffect(() => {
    if (!available) return;

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
      setState(
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
      setState(next);
    };

    const onEnd = () => {
      const { next, sync: fire } = pullEnd(live.current);
      scroller.current = null;
      setState(next);
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
