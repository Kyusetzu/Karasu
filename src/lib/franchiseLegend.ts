/** Whether the franchise graph's colour key is open; chrome, so it lives per machine, not per account. */

const KEY = "karasu-franchise-legend";

/** Closed until asked for, so the key never sits on the graph of someone who already knows the colours. */
export function loadLegendOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return false;
  }
}

export function saveLegendOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // Not worth surfacing: the key still opened, and failing the toggle over a storage quota would be worse.
  }
}
