/**
 * The interface-size steps, shared by the Appearance select and the
 * Ctrl+plus / Ctrl+minus / Ctrl+0 shortcuts so the two never disagree.
 *
 * Browser-like steps, bounded by what Rust accepts (`UI_ZOOM_MIN..=UI_ZOOM_MAX`
 * in `commands/system.rs`). A stored value off the list — an older build, a
 * hand-edited database — still displays and still steps: `stepZoom` moves to
 * the nearest step in the asked direction rather than snapping first, so
 * Ctrl+plus from 105 goes to 110, not to 125.
 */
export const UI_ZOOM_STEPS = [75, 90, 100, 110, 125, 150, 175, 200] as const;
export const UI_ZOOM_DEFAULT = 100;

/** The next step up (`1`) or down (`-1`) from `current`, clamped at the ends. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return UI_ZOOM_STEPS.find((s) => s > current) ?? UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1];
  }
  const below = UI_ZOOM_STEPS.filter((s) => s < current);
  return below.length > 0 ? below[below.length - 1] : UI_ZOOM_STEPS[0];
}

/**
 * Which shortcut a keydown is, or `null`. Ctrl (Cmd on macOS, should it ever
 * matter) with plus, equals (the unshifted plus on most layouts), minus or
 * zero — main row and numpad alike, which is why `code` is consulted beside
 * `key`. Alt is left out on purpose: AltGr arrives as Ctrl+Alt on Windows,
 * and a user typing a character through it is not asking to zoom.
 */
export function zoomShortcut(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): "in" | "out" | "reset" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Numpad0") return "reset";
  return null;
}
