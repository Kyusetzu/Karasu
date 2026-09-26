/** The palette's recent list: screens and commands only, never a title, so it cannot turn into a viewing history. */

const KEY = "karasu-palette-recent";

export const RECENT_MAX = 5;

/** A top-level screen path or a command id; parsed rather than prefix-matched, so a title's `/media/…` never passes. */
export function isRecordable(id: string): boolean {
  return /^\/[a-z]*$/.test(id) || /^command:[A-Za-z]+$/.test(id);
}

/** The list with `id` moved to the front, deduplicated and capped; anything not recordable leaves it unchanged. */
export function pushRecent(list: readonly string[], id: string): string[] {
  if (!isRecordable(id)) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

/** Whatever the stored value holds, reduced to recordable ids in order, each once, at most `RECENT_MAX`. */
export function parseRecent(raw: string | null): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const id of value) {
    if (typeof id === "string" && isRecordable(id) && !out.includes(id)) out.push(id);
    if (out.length === RECENT_MAX) break;
  }
  return out;
}

export function loadRecent(): string[] {
  try {
    return parseRecent(localStorage.getItem(KEY));
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return [];
  }
}

export function saveRecent(list: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // The command still ran; losing the reminder of it is not worth an error.
  }
}
