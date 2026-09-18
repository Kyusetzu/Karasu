import { maxProgress, type MediaListEntry } from "@/api/types";
import { canAdvance } from "@/lib/actions";

/** The row button's face of the shared rule; the menu and the sheet resolve it through `lib/actions` directly. */
export function canIncrement(entry: MediaListEntry) {
  return canAdvance(entry.progress, maxProgress(entry.media));
}

// Progress dropdowns only up to this length; long-runners keep +1 and the modal instead of a huge dropdown.
export const PROGRESS_DROPDOWN_LIMIT = 600;
