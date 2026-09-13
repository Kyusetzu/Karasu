import { STATUS_ORDER, type MediaListStatus } from "@/api/types";

/** The one status every add flow uses when the user has not said, kept per machine in localStorage. */

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
