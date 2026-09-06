import { useEffect, useRef, useState } from "react";

/** Must match `--duration-exit` in the generated tokens. */
export const EXIT_MS = 120;

function reduced(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keeps a node mounted for its exit animation. React unmounts before CSS can
 * animate, so `{open && <Sheet/>}` only ever has an entrance; this reports
 * `leaving` for the exit frames and unmounts after them. The app's hook of
 * the same name, reduced to what the site needs.
 */
export function usePresence(open: boolean, exitMs = EXIT_MS) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    const ms = reduced() ? 0 : exitMs;
    if (ms === 0) {
      setMounted(false);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // `mounted` is deliberately not a dependency: it flips inside this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  return { mounted, leaving };
}
