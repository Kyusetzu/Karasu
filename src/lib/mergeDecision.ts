/**
 * Which side of a sign-in merge wins.
 *
 * Pulled out of `SignInMerge` because it is the one decision in that dialog
 * that can destroy data: it runs once per local row, and every "yes" is an
 * overwrite of a real AniList entry with no undo. A component that fetches,
 * renders and decides in one file had no way to be tested on the answer alone.
 */

import type { FuzzyDate } from "@/api/types";

export type MergeStrategy = "newest" | "local" | "anilist";

/** One side of the comparison, in the only vocabulary both sides share. */
export interface MergeSide {
  status: string;
  progress: number;
  /**
   * The 0–100 raw score. The two lists speak different dialects — the local
   * one is ten-point by design, AniList's arrives in the *account's* format —
   * so a local ★8 against an online 80 is the same rating, not a conflict.
   */
  scoreRaw: number;
  /** Seconds since the epoch, as both sides report it. */
  updatedAt: number;
}

/** Whether the two sides describe different states at all. */
export const conflicts = (local: MergeSide, online: MergeSide): boolean =>
  local.status !== online.status ||
  local.progress !== online.progress ||
  local.scoreRaw !== online.scoreRaw;

/**
 * Whether the local row should overwrite the AniList one.
 *
 * `online` is null only when AniList genuinely has no entry for this media —
 * never as a stand-in for "the list could not be read". The caller has to
 * refuse the merge outright in that case, because every row would land here
 * looking like an addition and the whole local list would be pushed over an
 * account nobody looked at.
 */
export const localWins = (
  local: MergeSide,
  online: MergeSide | null,
  strategy: MergeStrategy,
): boolean => {
  if (!online) return true; // brand new → always push
  if (!conflicts(local, online)) return false; // identical → nothing to do
  if (strategy === "local") return true;
  if (strategy === "anilist") return false;
  return local.updatedAt >= online.updatedAt;
};

/**
 * The six fields `conflicts` does not compare — the ones that used to be lost.
 *
 * `conflicts` weighs status, progress and score, which is the right basis for
 * *"which side wins"*: they are what both lists always have and what a strategy
 * can meaningfully arbitrate. But the merge deletes the local row once it is
 * resolved, so a row agreeing on those three was cleared without ever being
 * pushed — taking any notes, tags, repeat count, volume count, privacy flag or
 * dates that existed only locally with it, while the tally counted it merged.
 */
export interface MergeExtras {
  progressVolumes: number;
  repeat: number;
  notes: string | null;
  private: boolean;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
}

/**
 * What a residual push sends — a strict subset of `SaveEntryInput`.
 *
 * Nullable in `MergeExtras` (both sides can be empty) and non-nullable here on
 * purpose: a field only appears once it has been found to carry a value, so the
 * patch never spells "clear this".
 */
export interface ResidualPatch {
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
  private?: boolean;
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
}

/** Empty-ish, in whichever spelling the side in hand uses. */
const someNotes = (n: string | null | undefined): n is string =>
  (n ?? "").trim() !== "";
const someDate = (d: FuzzyDate | null | undefined): d is FuzzyDate =>
  !!d && (d.year != null || d.month != null || d.day != null);

/**
 * What the local row knows that the AniList row does not.
 *
 * Deliberately **additive only**: a field is residual when local has a value
 * and online has none. It never reports a field where both sides have
 * something, because that is a conflict and `localWins` plus the user's chosen
 * strategy already own that decision — widening `conflicts` to these six
 * instead would manufacture conflicts out of nothing, since AniList returns
 * `notes: null` and all-null `FuzzyDate`s exactly where the local list stores
 * `""` and nulls. Under the default "newest" strategy, where ties go local,
 * those phantom conflicts would resolve by overwriting a real AniList entry —
 * the precise hazard this module was extracted to prevent.
 *
 * Returns a patch ready for `SaveMediaListEntry`, empty when nothing is at risk.
 */
export const residual = (
  local: MergeExtras,
  online: MergeExtras,
): ResidualPatch => {
  const out: ResidualPatch = {};
  if (local.progressVolumes > 0 && online.progressVolumes === 0) {
    out.progressVolumes = local.progressVolumes;
  }
  if (local.repeat > 0 && online.repeat === 0) out.repeat = local.repeat;
  if (someNotes(local.notes) && !someNotes(online.notes)) out.notes = local.notes;
  // Only ever tightens: a local row marked private must not be published by a
  // merge, but a merge must not un-publish one either.
  if (local.private && !online.private) out.private = true;
  if (someDate(local.startedAt) && !someDate(online.startedAt)) {
    out.startedAt = local.startedAt;
  }
  if (someDate(local.completedAt) && !someDate(online.completedAt)) {
    out.completedAt = local.completedAt;
  }
  return out;
};

/** Whether `residual` found anything — the guard before clearing a local row. */
export const hasResidual = (r: ResidualPatch): boolean =>
  Object.keys(r).length > 0;
