import { STATUS_ORDER, type MediaListStatus } from "@/api/types";

/**
 * Which status a title joins the list with, when the user has not said.
 *
 * Every add flow — the discovery grids' plus circle, the local library's
 * "add to list", the entry editor's seed for a title not yet on the list —
 * hard-coded Planning; this makes that one configurable value instead of
 * four agreeing literals. localStorage following `viewMode.ts` — per
 * machine, no sync, nothing to migrate. One value for both media types:
 * the statuses are the same six, only their display names differ.
 */

const KEY = "karasu-default-add-status";

export const DEFAULT_ADD_STATUS: MediaListStatus = "PLANNING";

export function loadDefaultAddStatus(): MediaListStatus {
  try {
    const saved = localStorage.getItem(KEY);
    return STATUS_ORDER.includes(saved as MediaListStatus)
      ? (saved as MediaListStatus)
      : DEFAULT_ADD_STATUS;
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return DEFAULT_ADD_STATUS;
  }
}

export function saveDefaultAddStatus(status: MediaListStatus): void {
  try {
    localStorage.setItem(KEY, status);
  } catch {
    // Not worth surfacing — the add still works, it just will not remember.
  }
}
