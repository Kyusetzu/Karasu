/**
 * Whether the sidebar is collapsed to icons, remembered per machine.
 *
 * Same shape and same reasoning as `viewMode.ts`: a localStorage key, a
 * validating reader, and both sides in a `try`. This is per-machine chrome like
 * the theme's density — it is about the screen you are sitting at, not about the
 * account, so it never goes near AniList and never goes near SQLite.
 *
 * A plain module rather than a Zustand store because exactly one component reads
 * it. The shell is flexbox, so `<main>` reflows on its own and nothing else has
 * to be told.
 */

const KEY = "karasu-sidebar";

/** Expanded. The labels are the app's navigation; icons alone are the choice. */
export const DEFAULT_COLLAPSED = false;

export function loadCollapsed(): boolean {
  try {
    // Compared against the literal rather than parsed, so anything a
    // hand-edit or an older build left behind reads as the default instead of
    // throwing on the first render of the shell.
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
    // Not worth surfacing: the sidebar still collapsed, it just will not be
    // remembered. Failing the toggle over a storage quota would be worse.
  }
}
