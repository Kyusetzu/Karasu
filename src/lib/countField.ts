/** A count field's text and its number: episodes, chapters, volumes and rewatches, which may be emptied mid-edit. */

/** Empty is 0 rather than nothing, so a cleared field never saves a null; unreadable is null; the rest lands in [0, max]. */
export function parseCount(raw: string, max = Number.POSITIVE_INFINITY): number | null {
  // Explicit, since `Number("")` is a finite 0 and would hide the difference between cleared and typed.
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const ceiling = max >= 0 ? Math.floor(max) : 0;
  return Math.min(Math.max(Math.trunc(n), 0), ceiling);
}

/** What the field shows for a stored count: nothing for 0, so there is no 0 to delete before typing. */
export function countText(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Math.trunc(value)) : "";
}
