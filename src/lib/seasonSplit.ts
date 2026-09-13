/** The season-split card's arithmetic; the preview shows the mapping so an off-by-one is caught before saving. */

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

/** The preview's shape: the first few pairs, an ellipsis count and the last pair, so a long split stays short. */
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
