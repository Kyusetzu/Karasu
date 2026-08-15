import { useEffect, useRef, type RefObject } from "react";

/**
 * What a dialog is allowed to keep the keyboard on.
 *
 * `[tabindex]:not([tabindex="-1"])` covers the app's own roving-focus targets;
 * `-1` is deliberately excluded, because that is the value used for "reachable
 * by script, not by Tab".
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Deliberately no layout check.
 *
 * `offsetParent`/`getClientRects` would be the thorough way to skip a control
 * inside a collapsed section — and it is the wrong tool twice over: jsdom has
 * no layout, so it reports *everything* as hidden and the whole trap silently
 * became a no-op under test; and the browser already refuses to focus a
 * `display: none` element, so the worst a stale entry can do here is make one
 * wrap attempt land on nothing. The attribute checks below are the cases a
 * browser would still happily focus.
 */
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden],[inert],[aria-hidden='true']"),
  );
}

/**
 * Keeps the keyboard inside an open dialog, and gives it back afterwards.
 *
 * Two separate bugs, one fix. Tab from the last control in any Karasu dialog
 * walked straight out into the page behind it — where the user could then
 * operate a list they could not see, under a scrim, with the dialog still open.
 * And closing one dropped focus to `<body>`, so the next Tab restarted from the
 * top of the document rather than from where the user had been.
 *
 * Deliberately not a library. The behaviour is thirty lines, it has to
 * cooperate with `usePresence` (the node outlives its own close by an
 * animation), and it must not fight an overlay that places its own initial
 * focus — of which there are three.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  /** False while the dialog is animating out: stop trapping, keep the restore. */
  active = true,
) {
  // Through a ref, so the trap reads the *current* value without the effect
  // re-running: a re-run would re-read `opener` from inside the dialog and
  // restore focus to the wrong place the moment the exit animation started.
  const live = useRef(active);
  live.current = active;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Whatever opened the dialog — the row, the button, the menu item. Read
    // once, on mount, because by cleanup time focus is inside the dialog.
    const opener = document.activeElement as HTMLElement | null;

    // Only if nothing inside has claimed it already: the match picker and the
    // two composers focus their own field, and stealing that would put the
    // caret in the wrong place.
    if (!root.contains(document.activeElement)) {
      const first = focusable(root)[0];
      if (first) first.focus();
      else {
        // A dialog with no controls at all still has to take the keyboard, or
        // Escape and the trap below have nothing to act on.
        root.tabIndex = -1;
        root.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !live.current) return;
      // Another overlay has the keyboard — a confirm opened from inside a
      // modal, most often. Both traps are registered on `document` in capture
      // phase and both would run, and this one (the outer, registered first)
      // would drag focus back out of the dialog the user is actually looking
      // at on the very first Tab. Only the overlay holding focus acts.
      const owner = (document.activeElement as HTMLElement | null)?.closest?.(
        "[data-overlay]",
      );
      const mine = root.closest("[data-overlay]") ?? root;
      if (owner && owner !== mine) return;
      const stops = focusable(root);
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      // Focus already outside — a click on the page behind, or a control that
      // vanished — is pulled back rather than left to walk further away.
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Deferred by a microtask, because React can still be removing the
      // dialog's nodes when this runs — and removing the focused node resets
      // `activeElement` to `<body>`, undoing the restore a moment after it
      // happened. Measured, not assumed: the test for this failed exactly that
      // way before the defer.
      queueMicrotask(() => {
        // Something else already has the keyboard — a dialog that opened a
        // confirm, most likely. Taking it back would be the rudest possible
        // reading of "restore focus".
        const now = document.activeElement;
        if (now && now !== document.body) return;
        // And only if the opener is still on the page: a dialog that deleted
        // the row it was opened from would otherwise focus a detached node,
        // which browsers answer with `<body>` — the thing this avoids.
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [ref]);
}
