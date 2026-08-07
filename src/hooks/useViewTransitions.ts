import { useEffect } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { prefersReducedMotion } from "@/lib/motion";

/** Marks the cover that should morph into the detail hero. */
export const HERO_ATTR = "data-hero-cover";
/** The `view-transition-name` both ends of that morph share. */
const HERO_NAME = "karasu-hero";

/**
 * Wraps in-app navigation in a View Transition.
 *
 * Intercepting clicks rather than using react-router's `viewTransition` prop,
 * which only works under a data router: this app uses the declarative
 * `HashRouter`, and `components.js` reaches for `router.window` — an object the
 * declarative router does not have. Migrating the entry point for a visual
 * nicety is a poor trade; a click listener is contained and works with every
 * `<Link>` already in the tree without touching one of them.
 *
 * `flushSync` is load-bearing. `startViewTransition` snapshots the DOM, runs the
 * callback, then snapshots again — so the navigation has to have committed by
 * the time the callback returns. A normal React update is async and would be
 * captured as "nothing changed".
 */
export function useViewTransitions() {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof document.startViewTransition !== "function") return;

    const onClick = (e: MouseEvent) => {
      // Anything but a plain left click belongs to the browser: modified
      // clicks open in new windows, and a middle click is a paste on Linux.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      // In-app routes only. The app is served from a hash router, so anything
      // that is not `#/…` is an external link the opener plugin handles.
      if (!anchor || !href?.startsWith("#/")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const to = href.slice(1);
      if (to === `${location.hash.slice(1) || "/"}`) return;

      // Respect the setting before taking the click over: with motion off this
      // must behave exactly as it did, which means not intercepting at all.
      if (prefersReducedMotion()) return;

      e.preventDefault();

      // A cover morphing into the detail hero. The name is applied to just the
      // clicked element, so only ever one node carries it in a given snapshot —
      // two would make the browser skip the pairing entirely.
      const cover = anchor.querySelector<HTMLElement>(`[${HERO_ATTR}]`);
      if (cover) cover.style.viewTransitionName = HERO_NAME;

      const transition = document.startViewTransition(() => {
        flushSync(() => navigate(to));
      });
      // Navigating again before the previous transition settles skips the old
      // one, and *both* of its promises reject with InvalidStateError. That is
      // ordinary — anyone clicking through the sidebar does it — but they are
      // browser-created promises, so a rejection nobody has attached to is an
      // uncaught rejection in the console. `ready` needs the handler even
      // though nothing here awaits it, for exactly that reason.
      transition.ready.catch(() => {});
      transition.finished
        .finally(() => {
          if (cover) cover.style.viewTransitionName = "";
        })
        .catch(() => {});
    };

    // Capture phase, and that is not a detail. React attaches its handlers to
    // the root container, so on the way *up* react-router's `<Link>` has
    // already navigated and called `preventDefault` — a bubble-phase listener
    // sees `defaultPrevented` and bails every single time. Capturing runs
    // first; `Link` then sees our own `preventDefault` and stands down, which
    // is exactly the handover we want.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
}
