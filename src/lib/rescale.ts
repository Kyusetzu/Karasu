import { scoreScale, toRaw, type ScoreFormat } from "./scoreFormat";

/**
 * The plan behind the bulk score rescale.
 *
 * AniList's bulk mutation writes *one* value to every id it is given, so a
 * rescale cannot be one request — it is one request per distinct target
 * score (chunked at 50 ids), which for a ten-point account is at most ten.
 * Planning is separated from writing so the tool can say exactly what a
 * click will do — how many entries move and how many requests it costs —
 * before anything is sent.
 */

export interface RescaleGroup {
  /** The snapped target score, in display units. */
  score: number;
  entries: { id: number; mediaId: number }[];
}

export interface RescalePlan {
  groups: RescaleGroup[];
  /** Entries whose score actually changes. */
  affected: number;
  /** Unscored, outside the source range, or already at their target. */
  untouched: number;
  /** Bulk requests the apply will spend (50 ids per chunk). */
  requests: number;
}

/**
 * Maps every scored entry inside `[from.min, from.max]` linearly onto
 * `[to.min, to.max]`, snapped to the format's step and clamped to its
 * scale. Unscored entries (0) are never touched — zero means "no opinion",
 * and a rescale must not invent one.
 */
export function planRescale(
  entries: { id: number; mediaId: number; score: number }[],
  from: { min: number; max: number },
  to: { min: number; max: number },
  format: ScoreFormat,
): RescalePlan {
  const { step, max: scaleMax } = scoreScale(format);
  const byScore = new Map<number, { id: number; mediaId: number }[]>();
  let affected = 0;
  let untouched = 0;

  for (const e of entries) {
    if (e.score <= 0 || e.score < from.min || e.score > from.max) {
      untouched += 1;
      continue;
    }
    const mapped =
      from.max === from.min
        ? to.min
        : to.min + ((e.score - from.min) * (to.max - to.min)) / (from.max - from.min);
    // Snap to the format's step; the floor is one step, not zero — a rescale
    // may make a score small, but only clearing may make it disappear.
    const snapped = Number(
      Math.min(scaleMax, Math.max(step, Math.round(mapped / step) * step)).toFixed(2),
    );
    if (toRaw(format, snapped) === toRaw(format, e.score)) {
      untouched += 1;
      continue;
    }
    affected += 1;
    const group = byScore.get(snapped) ?? [];
    group.push({ id: e.id, mediaId: e.mediaId });
    byScore.set(snapped, group);
  }

  const groups = [...byScore.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, list]) => ({ score, entries: list }));
  const requests = groups.reduce((n, g) => n + Math.ceil(g.entries.length / 50), 0);
  return { groups, affected, untouched, requests };
}
