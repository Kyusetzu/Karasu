import type { FuzzyDate, MediaListStatus, SaveEntryInput } from "@/api/types";

/** The fields a save can touch, as they were before it. */
export interface EntrySnapshot {
  status: MediaListStatus;
  progress: number;
  progressVolumes: number;
  score: number;
  repeat: number;
  notes: string | null;
  private: boolean;
  hiddenFromStatusLists: boolean | null;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
}

/** Every field of a save this can put back: each is a plain value the snapshot holds, so restoring is one assignment. */
const FIELDS = [
  "status",
  "progress",
  "progressVolumes",
  "score",
  "repeat",
  "notes",
  "private",
  "hiddenFromStatusLists",
  "startedAt",
  "completedAt",
] as const;

/** Fields read in one shape and written in another, so a save touching one gets no Undo rather than a partial one. */
const IRREVERSIBLE = ["customLists", "advancedScores"] as const;

/** Fuzzy dates are objects, so `!==` sees two equal dates as different. */
const sameDate = (a: FuzzyDate | null | undefined, b: FuzzyDate | null | undefined) =>
  (a?.year ?? null) === (b?.year ?? null) &&
  (a?.month ?? null) === (b?.month ?? null) &&
  (a?.day ?? null) === (b?.day ?? null);

/** The save that puts an entry back: a new write naming only the changed fields, never a rollback of the whole cache. */
export function inverse(
  input: SaveEntryInput,
  before: EntrySnapshot,
): SaveEntryInput | null {
  if (IRREVERSIBLE.some((f) => input[f] !== undefined)) return null;
  const undo: SaveEntryInput = { mediaId: input.mediaId };
  // A loose alias so the loop can assign by field name; TypeScript cannot see the two sides line up across the union.
  const write = undo as unknown as Record<string, unknown>;
  let changed = false;

  for (const field of FIELDS) {
    const next = input[field];
    // `undefined` means the save did not mention the field, unlike one set to a falsy value, so this is not truthiness.
    if (next === undefined) continue;
    const prior = before[field];
    if (field === "startedAt" || field === "completedAt") {
      if (sameDate(next as FuzzyDate | null, prior as FuzzyDate | null)) continue;
      // A cleared date is AniList's own spelling of one — every part null.
      write[field] = prior ?? { year: null, month: null, day: null };
      changed = true;
      continue;
    }
    if (next === prior) continue;
    // A missing note reads back as `null`, but the mutation only takes a string, and "" is how AniList spells "no note".
    write[field] = field === "notes" && prior === null ? "" : prior;
    changed = true;
  }

  return changed ? undo : null;
}

/** Which single change the receipt names, since a save carries several fields and one of them is the point. */
export function headline(
  input: SaveEntryInput,
  before: EntrySnapshot,
): { field: (typeof FIELDS)[number]; value: unknown } | null {
  const order = [
    "progress",
    "progressVolumes",
    "status",
    "score",
    "repeat",
    "notes",
  ] as const;
  // Completing is the point of the save, and the totals it fills are its consequence rather than its headline.
  if (input.status === "COMPLETED" && before.status !== "COMPLETED") {
    return { field: "status", value: input.status };
  }
  for (const field of order) {
    const next = input[field];
    if (next === undefined || next === before[field]) continue;
    return { field, value: next };
  }
  return null;
}
