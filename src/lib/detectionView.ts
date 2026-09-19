/** Whether the floating detection surface is shown in full or collapsed; chrome, so it lives per machine, not per account. */

export type DetectionView = "expanded" | "compact";

const KEY = "karasu-detection-view";

/** Expanded, because the card arrives unprompted and its whole point is to be readable without a click. */
export const DEFAULT_DETECTION_VIEW: DetectionView = "expanded";

function isDetectionView(value: unknown): value is DetectionView {
  return value === "expanded" || value === "compact";
}

export function loadDetectionView(): DetectionView {
  try {
    const saved = localStorage.getItem(KEY);
    return isDetectionView(saved) ? saved : DEFAULT_DETECTION_VIEW;
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return DEFAULT_DETECTION_VIEW;
  }
}

export function saveDetectionView(view: DetectionView): void {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // Not worth surfacing: the view still changed, and failing the toggle over a storage quota would be worse.
  }
}
