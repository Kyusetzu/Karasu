import { useEffect, useRef } from "react";
import { createBackStack } from "@/lib/backStack";

/** One back stack and one popstate listener for the whole app, created lazily because node tests have no `window`. */
let stack: ReturnType<typeof createBackStack> | null = null;
function ensure() {
  if (!stack) {
    stack = createBackStack(window.history);
    window.addEventListener("popstate", () => stack!.onPopState());
  }
  return stack;
}

/** While `open`, the back gesture closes this overlay instead of navigating; the protocol is `lib/backStack`. */
export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return ensure().register(() => closeRef.current());
  }, [open]);
}
