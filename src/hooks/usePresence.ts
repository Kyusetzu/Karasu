import { useEffect, useRef, useState } from "react";
import { motionDuration } from "@/lib/motion";

/** What the caller should render. */
export interface Presence {
  /** Render the node at all. Stays true while it animates out. */
  mounted: boolean;
  /** The node is on its way out — apply the exit animation. */
  leaving: boolean;
}

/**
 * Keeps a node mounted for the length of its exit animation.
 *
 * CSS cannot animate an element React has already removed, and every overlay in
 * this app was plain conditional rendering — `{open && <Modal/>}` — so they all
 * arrived with an animation and vanished mid-frame. This is the missing half:
 * `mounted` stays true for `exitMs` after `open` goes false, with `leaving` set
 * so the caller can swap in the exit animation.
 *
 * Under reduced motion `exitMs` collapses to 0 and the unmount is immediate,
 * which is why the duration goes through `motionDuration` rather than being
 * used raw — the CSS `!important` rules cannot reach a `setTimeout`.
 *
 * The timer is keyed to the close it was started for: reopening while an exit
 * is in flight cancels it, so a fast toggle cannot unmount a node that is open
 * again by the time the timer fires.
 */
export function usePresence(open: boolean, exitMs = 120): Presence {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }

    const wait = motionDuration(exitMs);
    if (wait === 0) {
      setMounted(false);
      setLeaving(false);
      return;
    }

    setLeaving(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(false);
      setLeaving(false);
    }, wait);

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [open, exitMs]);

  // `leaving` is only meaningful while something is still on screen.
  return { mounted, leaving: mounted && leaving && !open };
}
