import type { MediaListEntry } from "@/api/types";
import { displayTitle } from "@/api/types";

/**
 * Statistics AniList cannot answer, computed from the cached list.
 *
 * `LIST_QUERY` already carries per-entry scores, the community's
 * `averageScore`, fuzzy start/completion dates and season facts — enough for
 * whole tabs that cost **zero requests** and work offline. Everything here is
 * pure over the entries the caller already holds; the content filter runs at
 * the call site, on the same filtered pool every other panel reads.
 *
 * Scores: the user's is ten-point (`score(format: POINT_10)`), the community's
 * is hundred-point (`averageScore`) — normalized here, at the boundary, like
 * `normalizeStatsBlock` does for the statistics endpoint.
 */

export interface DeltaRow {
  mediaId: number;
  title: string;
  /** The user's ten-point score. */
  mine: number;
  /** The community mean, brought onto the same scale. */
  community: number;
  /** `mine - community` — negative means harsher than the crowd. */
  delta: number;
}

export interface ScoreDeltaSummary {
  /** Entries that carry both scores — the honest denominator. */
  count: number;
  meanMine: number;
  meanCommunity: number;
  /** Mean of the per-entry deltas. */
  meanDelta: number;
  /** The user's biggest downward disagreements, most negative first. */
  harshest: DeltaRow[];
  /** The biggest upward ones, most positive first. */
  kindest: DeltaRow[];
}

/**
 * How the user's scores sit against the community's, for the titles where
 * both exist. Unscored entries and titles AniList has no mean for are
 * excluded rather than counted as zero — a zero *is* the absence here, and
 * averaging it in would drag the mean toward an opinion nobody holds.
 */
export function scoreDelta(entries: MediaListEntry[], top = 5): ScoreDeltaSummary | null {
  const seen = new Set<number>();
  const rows: DeltaRow[] = [];
  for (const e of entries) {
    if (seen.has(e.mediaId)) continue;
    seen.add(e.mediaId);
    const community = e.media.averageScore;
    if (!e.score || e.score <= 0 || community == null || community <= 0) continue;
    const communityTen = community / 10;
    rows.push({
      mediaId: e.mediaId,
      title: displayTitle(e.media.title),
      mine: e.score,
      community: communityTen,
      delta: e.score - communityTen,
    });
  }
  if (rows.length === 0) return null;

  const mean = (pick: (r: DeltaRow) => number) =>
    rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
  const byDelta = [...rows].sort((a, b) => a.delta - b.delta);

  return {
    count: rows.length,
    meanMine: mean((r) => r.mine),
    meanCommunity: mean((r) => r.community),
    meanDelta: mean((r) => r.delta),
    harshest: byDelta.filter((r) => r.delta < 0).slice(0, top),
    kindest: byDelta
      .filter((r) => r.delta > 0)
      .reverse()
      .slice(0, top),
  };
}
