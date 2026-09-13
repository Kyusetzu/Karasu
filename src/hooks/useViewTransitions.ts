import { useEffect } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { prefersReducedMotion } from "@/lib/motion";

/** Marks the cover that should morph into the detail hero. */
export const HERO_ATTR = "data-hero-cover";
/** The `view-transition-name` both ends of that morph share. */
const HERO_NAME = "karasu-hero";

/** Wraps in-app navigation in a View Transition by intercepting clicks; keep `flushSync`, or the snapshot sees no change. */
export function useViewTransitions() {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof document.startViewTransition !== "function") return;

    const onClick = (e: MouseEvent) => {
      // Anything but a plain left click belongs to the browser (new windows, the Linux middle-click paste).
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      // In-app routes only; under the hash router anything not `#/…` is an external link the opener handles.
      if (!anchor || !href?.startsWith("#/")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const to = href.slice(1);
      if (to === `${location.hash.slice(1) || "/"}`) return;

      // With motion off this must not intercept at all, so check the setting before taking the click over.
      if (prefersReducedMotion()) return;

      e.preventDefault();

      // The name goes on the clicked cover only; two nodes carrying it in one snapshot make the browser skip the pairing.
      const cover = anchor.querySelector<HTMLElement>(`[${HERO_ATTR}]`);
      if (cover) cover.style.viewTransitionName = HERO_NAME;

      const transition = document.startViewTransition(() => {
        flushSync(() => navigate(to));
      });
      // Keep the `ready` handler; a skipped transition rejects both promises, and an unhandled one is a console error.
      transition.ready.catch(() => {});
      transition.finished
        .finally(() => {
          if (cover) cover.style.viewTransitionName = "";
        })
        .catch(() => {});
    };

    // Keep the capture phase; in bubble phase `<Link>` has already navigated and this listener bails every time.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
}
