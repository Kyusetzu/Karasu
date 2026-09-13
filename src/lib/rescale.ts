import { scoreScale, toRaw, type ScoreFormat } from "./scoreFormat";

/** The bulk score rescale planned apart from the write, one request per distinct target score, so a click can be priced. */

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

/** Maps scored entries in the source range linearly onto the target, snapped and clamped; unscored entries stay unscored. */
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
    // Snap to the format's step with a floor of one step, since only clearing may make a score disappear.
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
