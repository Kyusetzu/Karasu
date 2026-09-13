import { maxProgress, type MediaListEntry } from "@/api/types";
export function canIncrement(entry: MediaListEntry) {
  const max = maxProgress(entry.media);
  return max === null || entry.progress < max;
}

// Progress dropdowns only up to this length; long-runners keep +1 and the modal instead of a huge dropdown.
export const PROGRESS_DROPDOWN_LIMIT = 600;
