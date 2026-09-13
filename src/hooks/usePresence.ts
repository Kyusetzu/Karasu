import { useEffect, useRef, useState } from "react";
import { motionDuration } from "@/lib/motion";

/** What the caller should render. */
export interface Presence {
  /** Render the node at all. Stays true while it animates out. */
  mounted: boolean;
  /** The node is on its way out — apply the exit animation. */
  leaving: boolean;
}

/** The default exit hold; keep it equal to `--duration-exit` in `index.css`, or the node dies before the CSS finishes. */
const EXIT_MS = 120;

/** Keeps a node mounted for its exit animation; the wait goes through `motionDuration` because CSS cannot reach a timer. */
export function usePresence(open: boolean, exitMs = EXIT_MS): Presence {
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

/** `Presence`, plus the value the overlay was opened with. */
export interface ValuePresence<T> extends Presence {
  /** The last non-null value — retained so an exiting overlay still renders. */
  value: T | null;
}

/** `usePresence` for overlays whose visibility is their data; the last non-null value is retained so the exit renders it. */
export function usePresentValue<T>(
  value: T | null | undefined,
  exitMs = EXIT_MS,
): ValuePresence<T> {
  const presence = usePresence(value != null, exitMs);
  const last = useRef<T | null>(null);
  if (value != null) last.current = value;
  return { ...presence, value: presence.mounted ? last.current : null };
}
