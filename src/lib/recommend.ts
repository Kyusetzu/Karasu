/**
 * Recommendations built from what you've already finished.
 *
 * AniList's `Media.recommendations` is community-voted "if you liked X, try
 * Y". One title's recommendations are a shallow list; the useful signal comes
 * from asking many of your completed entries at once and seeing which titles
 * keep coming back — weighted by how much *you* liked the thing that
 * suggested them.
 *
 * All of this is pure so it can be tested without a network or a renderer;
 * the query lives in `api/queries.ts` and the rendering in
 * `components/RecommendedSection.tsx`.
 */
import type { MediaListEntry, MediaType } from "@/api/types";
import type { MediaWithListStatus } from "@/api/queries";

/** One `mediaRecommendation` node, flattened with the seed that produced it. */
export interface RawRecommendation {
  /** The completed entry whose recommendations this came from. */
  seedId: number;
  /** AniList's community vote count. Can be negative — see below. */
  rating: number;
  media: MediaWithListStatus;
}

export interface SeedEntry {
  mediaId: number;
  /** POINT_10; 0 means unscored. */
  score: number;
}

export interface ScoredRecommendation {
  media: MediaWithListStatus;
  /** Summed weight across every seed that recommended it. */
  weight: number;
  /** The seed that contributed most, for "because you finished …". */
  topSeedId: number;
  /** How many distinct completed entries pointed here. */
  seedCount: number;
}

/**
 * How much a completed entry's opinion counts.
 *
 * An unscored entry counts as a 7/10: you finished it, which is a mild
 * endorsement, but you never said you liked it. The point of weighting at all
 * is the other end — a 3/10 you slogged through shouldn't drag its
 * recommendations to the top of the page just because you saw it through.
 */
export function seedWeight(score: number): number {
  return score > 0 ? score / 10 : 0.7;
}

/**
 * The completed entries worth asking about, best-liked first.
 *
 * Capped because every seed is a sub-selection in one batched query — 25 keeps
 * it to a single request well inside AniList's rate limit. Sorting by score
 * means the cap drops the entries whose opinion we'd weight least anyway.
 */
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
}

/**
 * Aggregates raw recommendation nodes into a ranked list.
 *
 * Notable exclusions:
 * - `rating <= 0`. AniList lets users vote a recommendation *down*, so a node
 *   can arrive with a negative rating meaning "these are nothing alike".
 *   Summing those unfiltered would let a widely-rejected pairing count as
 *   support.
 * - Anything already on the user's list. The exclude set is built from the
 *   fetched list rather than from `mediaListEntry`, which is null in
 *   local-only mode where the AniList query runs unauthenticated.
 * - The wrong media type — an anime's recommendations can include manga.
 */
export function rankRecommendations(
  recs: RawRecommendation[],
  { seeds, exclude, type, limit = 12, isHidden }: RankOptions,
): ScoredRecommendation[] {
  const weightOf = new Map(seeds.map((s) => [s.mediaId, seedWeight(s.score)]));

  interface Acc {
    media: MediaWithListStatus;
    weight: number;
    topSeedId: number;
    topSeedWeight: number;
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
        seedCount: 1,
      });
      continue;
    }
    existing.weight += contribution;
    existing.seedCount += 1;
    if (contribution > existing.topSeedWeight) {
      existing.topSeedWeight = contribution;
      existing.topSeedId = rec.seedId;
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.weight - a.weight || a.media.id - b.media.id)
    .slice(0, limit)
    .map(({ media, weight, topSeedId, seedCount }) => ({
      media,
      weight,
      topSeedId,
      seedCount,
    }));
}
