/** Whether the sidebar is collapsed, remembered in localStorage per machine because it is chrome, not account data. */

const KEY = "karasu-sidebar";

/** Expanded. The labels are the app's navigation; icons alone are the choice. */
export const DEFAULT_COLLAPSED = false;

export function loadCollapsed(): boolean {
  try {
    // Compared against the literal rather than parsed, so a stray value reads as the default instead of throwing.
    return localStorage.getItem(KEY) === "true";
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return DEFAULT_COLLAPSED;
  }
}

export function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, String(collapsed));
  } catch {
    // Not worth surfacing: the sidebar still collapsed, and failing the toggle over a storage quota would be worse.
  }
}
