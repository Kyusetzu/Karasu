/**
 * Which side of a sign-in merge wins.
 *
 * Pulled out of `SignInMerge` because it is the one decision in that dialog
 * that can destroy data: it runs once per local row, and every "yes" is an
 * overwrite of a real AniList entry with no undo. A component that fetches,
 * renders and decides in one file had no way to be tested on the answer alone.
 */

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
