import type { MediaListStatus, SaveEntryInput } from "@/api/types";

/** The fields a save can touch, as they were before it. */
export interface EntrySnapshot {
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
  notes: string | null;
}

/** Every field of a save that is actually an edit, minus the id. */
const FIELDS = ["status", "progress", "score", "repeat", "notes"] as const;

/**
 * The save that puts an entry back the way it was.
 *
 * **Undo is a new write, not a rollback.** Restoring a snapshot of the whole
 * cache would also revert anything that landed in between — a scrobble, a bulk
 * edit, a change made on anilist.co and pulled down by a refetch. So the
 * inverse only mentions the fields this particular save changed, and leaves
 * every other field to whatever its current value happens to be.
 *
 * Returns `null` when the save changed nothing, because a receipt offering to
 * undo a no-op is noise.
 */
export function inverse(
  input: SaveEntryInput,
  before: EntrySnapshot,
): SaveEntryInput | null {
  const undo: SaveEntryInput = { mediaId: input.mediaId };
  // Written through a loose alias so the loop can assign by field name.
  // TypeScript cannot see that `input[field]` and `before[field]` line up
  // across the union, and spelling the five assignments out by hand would be
  // five chances to forget one.
  const write = undo as unknown as Record<string, unknown>;
  let changed = false;

  for (const field of FIELDS) {
    const next = input[field];
    // `undefined` means "this save did not mention the field" — distinct from
    // a field it set to a falsy value, which is why the check is not truthiness.
    if (next === undefined) continue;
    const prior = before[field];
    if (next === prior) continue;
    // An entry with no note reads back as `null`, but the mutation only takes a
    // string. Empty string is how AniList spells "no note", so undoing onto one
    // has to clear rather than skip.
    write[field] = field === "notes" && prior === null ? "" : prior;
    changed = true;
  }

  return changed ? undo : null;
}

/**
 * Which single change to name in the receipt.
 *
 * A save can carry several fields — the editor sends all of them — but a
 * receipt that lists five is unreadable, and in practice one of them is the
 * point. Progress first because it is the overwhelming majority of writes,
 * then status, then score.
 */
export function headline(
  input: SaveEntryInput,
  before: EntrySnapshot,
): { field: (typeof FIELDS)[number]; value: unknown } | null {
  const order = ["progress", "status", "score", "repeat", "notes"] as const;
  for (const field of order) {
    const next = input[field];
    if (next === undefined || next === before[field]) continue;
    return { field, value: next };
  }
  return null;
}
