/** The zoom steps for the select and the Ctrl shortcuts alike; keep them inside Rust's `UI_ZOOM_MIN..=UI_ZOOM_MAX`. */
export const UI_ZOOM_STEPS = [75, 90, 100, 110, 125, 150, 175, 200] as const;
export const UI_ZOOM_DEFAULT = 100;

/** The next step up (`1`) or down (`-1`) from `current`, clamped; an off-list value steps rather than snapping first. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return UI_ZOOM_STEPS.find((s) => s > current) ?? UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1];
  }
  const below = UI_ZOOM_STEPS.filter((s) => s < current);
  return below.length > 0 ? below[below.length - 1] : UI_ZOOM_STEPS[0];
}

/** Which zoom shortcut a keydown is, or `null`; Alt is excluded because AltGr arrives as Ctrl+Alt on Windows. */
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
