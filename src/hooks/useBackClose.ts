import { useEffect, useRef } from "react";
import { createBackStack } from "@/lib/backStack";

/**
 * One back stack and one popstate listener for the whole app, created on
 * first use — `window` does not exist when the node test project imports.
 */
let stack: ReturnType<typeof createBackStack> | null = null;
function ensure() {
  if (!stack) {
    stack = createBackStack(window.history);
    window.addEventListener("popstate", () => stack!.onPopState());
  }
  return stack;
}

/**
 * While `open`, the Android back gesture (and the browser's back button)
 * closes this overlay instead of navigating. See `lib/backStack` for the
 * protocol; this is only the React glue. `onClose` rides a ref so the
 * registration survives re-renders with a fresh closure.
 */
export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return ensure().register(() => closeRef.current());
  }, [open]);
}
