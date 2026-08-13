/**
 * The season-split card's arithmetic, pure and previewable.
 *
 * A split says "disk episodes `from..=to` are another show, renumbered from
 * `dstStart`" — the same record shape as a community anime-relations rule. The
 * preview exists so the user confirms the *mapping*, not just the idea: seeing
 * "episode 13 → episode 1" is what catches an off-by-one before it is saved.
 */

export interface SplitPair {
  disk: number;
  renumbered: number;
}

/** Every disk→renumbered pair of a split, or `[]` for a reversed range. */
export function splitMapping(from: number, to: number, dstStart: number): SplitPair[] {
  if (to < from || from < 1 || dstStart < 1) return [];
  const pairs: SplitPair[] = [];
  for (let ep = from; ep <= to; ep++) {
    pairs.push({ disk: ep, renumbered: ep - from + dstStart });
  }
  return pairs;
}

/**
 * The preview's shape: the first few pairs, an ellipsis count, and the last
 * pair — a 200-episode split must not render 200 lines to say one thing.
 */
export function previewMapping(
  from: number,
  to: number,
  dstStart: number,
  head = 3,
): { shown: SplitPair[]; hidden: number; last: SplitPair | null } {
  const all = splitMapping(from, to, dstStart);
  if (all.length <= head + 1) {
    return { shown: all, hidden: 0, last: null };
  }
  return {
    shown: all.slice(0, head),
    hidden: all.length - head - 1,
    last: all[all.length - 1],
  };
}
