/** Recommendations from many completed entries at once, weighted by how much you liked the title that suggested each. */
import type { MediaListEntry, MediaType } from "@/api/types";
import type { MediaWithListStatus } from "@/api/queries";

/** One `mediaRecommendation` node, flattened with the seed that produced it. */
export interface RawRecommendation {
  /** The completed entry whose recommendations this came from. */
  seedId: number;
  /** AniList's community vote count; negative means voted down. */
  rating: number;
  /** RATE_UP | RATE_DOWN | NO_RATING — the viewer's own vote, if fetched. */
  userRating?: string | null;
  media: MediaWithListStatus;
}

export interface SeedEntry {
  mediaId: number;
  /** In the account's display units; 0 means unscored. */
  score: number;
}

export interface ScoredRecommendation {
  media: MediaWithListStatus;
  /** Summed weight across every seed that recommended it. */
  weight: number;
  /** The seed that contributed most, for "because you finished …". */
  topSeedId: number;
  /** The viewer's vote on the top pairing, the one the caption names and a vote button acts on. */
  userRating: string | null;
  /** How many distinct completed entries pointed here. */
  seedCount: number;
}

/** How much a completed entry's opinion counts, a fraction of the scale's `max`; unscored is a mild endorsement. */
export function seedWeight(score: number, max = 10): number {
  return score > 0 ? score / max : 0.7;
}

/** The completed entries worth asking about, best-liked first and capped so every seed fits one batched request. */
export function pickSeeds(
  entries: MediaListEntry[],
  limit = 25,
): SeedEntry[] {
  const seen = new Set<number>();
  return entries
    .filter((e) => e.status === "COMPLETED")
    .filter((e) => {
      if (seen.has(e.mediaId)) return false;
      seen.add(e.mediaId);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((e) => ({ mediaId: e.mediaId, score: e.score }));
}

export interface RankOptions {
  seeds: SeedEntry[];
  /** Media ids already on the user's list, in any status. */
  exclude: Set<number>;
  type: MediaType;
  limit?: number;
  /** Applied per candidate; the caller supplies the content-filter check. */
  isHidden?: (media: MediaWithListStatus) => boolean;
  /** The score scale's maximum, from `scoreScale(format).max`. */
  scoreMax?: number;
}

/** Ranks raw nodes, skipping down-voted pairings, the wrong media type and anything already on the fetched list. */
export function rankRecommendations(
  recs: RawRecommendation[],
  { seeds, exclude, type, limit = 12, isHidden, scoreMax = 10 }: RankOptions,
): ScoredRecommendation[] {
  const weightOf = new Map(
    seeds.map((s) => [s.mediaId, seedWeight(s.score, scoreMax)]),
  );

  interface Acc {
    media: MediaWithListStatus;
    weight: number;
    topSeedId: number;
    topSeedWeight: number;
    userRating: string | null;
    seedCount: number;
  }
  const totals = new Map<number, Acc>();

  for (const rec of recs) {
    if (rec.rating <= 0) continue;
    if (!rec.media || rec.media.type !== type) continue;
    if (exclude.has(rec.media.id)) continue;
    if (isHidden?.(rec.media)) continue;

    const contribution = rec.rating * (weightOf.get(rec.seedId) ?? 0);
    if (contribution <= 0) continue;

    const existing = totals.get(rec.media.id);
    if (!existing) {
      totals.set(rec.media.id, {
        media: rec.media,
        weight: contribution,
        topSeedId: rec.seedId,
        topSeedWeight: contribution,
        userRating: rec.userRating ?? null,
        seedCount: 1,
      });
      continue;
    }
    existing.weight += contribution;
    existing.seedCount += 1;
    if (contribution > existing.topSeedWeight) {
      existing.topSeedWeight = contribution;
      existing.topSeedId = rec.seedId;
      // The vote rides with the pairing the caption names.
      existing.userRating = rec.userRating ?? null;
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.weight - a.weight || a.media.id - b.media.id)
    .slice(0, limit)
    .map(({ media, weight, topSeedId, userRating, seedCount }) => ({
      media,
      weight,
      topSeedId,
      userRating,
      seedCount,
    }));
}
