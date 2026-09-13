/** Which side of a sign-in merge wins, kept pure because every "yes" overwrites a real AniList entry with no undo. */

import type { FuzzyDate } from "@/api/types";

export type MergeStrategy = "newest" | "local" | "anilist";

/** One side of the comparison, in the only vocabulary both sides share. */
export interface MergeSide {
  status: string;
  progress: number;
  /** The raw score, since the local list is ten-point and AniList's is in the account's format. */
  scoreRaw: number;
  /** Seconds since the epoch, as both sides report it. */
  updatedAt: number;
}

/** Whether the two sides describe different states at all. */
export const conflicts = (local: MergeSide, online: MergeSide): boolean =>
  local.status !== online.status ||
  local.progress !== online.progress ||
  local.scoreRaw !== online.scoreRaw;

/** Whether the local row overwrites AniList's; `online` is null only for a missing entry, never for an unread list. */
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

/** The fields `conflicts` does not compare, which the merge must still push before it clears the local row. */
export interface MergeExtras {
  progressVolumes: number;
  repeat: number;
  notes: string | null;
  private: boolean;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
}

/** What a residual push sends, non-nullable on purpose: a field appears only with a value, never as "clear this". */
export interface ResidualPatch {
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
  private?: boolean;
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
}

/** Non-empty notes, in whichever spelling the side in hand uses. */
const someNotes = (n: string | null | undefined): n is string =>
  (n ?? "").trim() !== "";
/** A date with at least one part, in whichever spelling the side in hand uses. */
const someDate = (d: FuzzyDate | null | undefined): d is FuzzyDate =>
  !!d && (d.year != null || d.month != null || d.day != null);

/** What local knows that AniList does not, additive only; widening `conflicts` to these would manufacture conflicts. */
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
  // Only ever tightens: a merge must neither publish a private local row nor un-publish an online one.
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
