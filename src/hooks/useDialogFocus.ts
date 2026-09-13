import { useEffect, useRef, type RefObject } from "react";

/** What a dialog may keep the keyboard on; `tabindex="-1"` is excluded because it means script-only. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Keep this attribute-only; a layout check reports everything hidden under jsdom and silently disables the trap. */
function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden],[inert],[aria-hidden='true']"),
  );
}

/** Keeps the keyboard inside an open dialog and hands it back to the opener afterwards. */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  /** False while the dialog is animating out: stop trapping, keep the restore. */
  active = true,
) {
  // A ref, so the trap reads the current value without the effect re-running and re-reading `opener` from inside.
  const live = useRef(active);
  live.current = active;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Whatever opened the dialog, read once on mount because by cleanup time focus is inside the dialog.
    const opener = document.activeElement as HTMLElement | null;

    // Only if nothing inside has claimed focus already; overlays that place their own caret must keep it.
    if (!root.contains(document.activeElement)) {
      const first = focusable(root)[0];
      if (first) first.focus();
      else {
        // A dialog with no controls still has to take the keyboard, or Escape and the trap have nothing to act on.
        root.tabIndex = -1;
        root.focus();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !live.current) return;
      // Only the overlay holding focus acts; both traps run on document, and the outer one would drag focus out.
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
      // Focus already outside (a click behind, a vanished control) is pulled back rather than left to walk away.
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
      // Keep the microtask; React may still be removing the focused node, which resets activeElement to body.
      queueMicrotask(() => {
        // Something else already has the keyboard (a confirm opened from here, say); leave it there.
        const now = document.activeElement;
        if (now && now !== document.body) return;
        // Only a still-attached opener; focusing a detached node lands on body, the thing this avoids.
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [ref]);
}
