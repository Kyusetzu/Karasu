import { maxProgress, type MediaListEntry } from "@/api/types";
export function canIncrement(entry: MediaListEntry) {
  const max = maxProgress(entry.media);
  return max === null || entry.progress < max;
}

// Progress dropdowns only up to this length (long-runners like One Piece
// keep +1/modal instead of a 1000-entry dropdown)
export const PROGRESS_DROPDOWN_LIMIT = 600;
