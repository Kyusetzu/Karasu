/**
 * Score affinity between two lists, on the raw hundred-point scale.
 *
 * Raw, because the two sides speak different dialects — the viewer's list
 * arrives in their format, the profile owner's in *theirs* — and `toRaw`
 * already exists to make exactly this comparison sound (the sign-in merge
 * uses it the same way). Pearson correlation over the shared scored titles:
 * +1 is "same taste", 0 is "unrelated", negative is "opposites".
 */

export interface AffinityEntry {
  mediaId: number;
  /** 0–100; 0 means unscored. */
  raw: number;
}

export interface Disagreement {
  mediaId: number;
  mineRaw: number;
  theirsRaw: number;
  /** theirs − mine: positive means they liked it more. */
  diff: number;
}

export interface AffinityResult {
  /** Titles on both lists, any status, scored or not. */
  shared: number;
  /** Titles both sides scored — the affinity's honest denominator. */
  scoredShared: number;
  /** Pearson over the scored shared titles; null below the floor or when a
      side's scores have no variance (a constant scorer correlates with
      nothing, which is a fact about the maths, not the people). */
  pearson: number | null;
  /** Largest absolute score gaps, biggest first. */
  disagreements: Disagreement[];
}

/** Below this many shared scored titles a correlation is noise, not taste. */
export const AFFINITY_MIN_SHARED = 5;

export function affinity(
  mine: AffinityEntry[],
  theirs: AffinityEntry[],
  top = 3,
): AffinityResult {
  const mineBy = new Map<number, number>();
  for (const e of mine) {
    if (!mineBy.has(e.mediaId)) mineBy.set(e.mediaId, e.raw);
  }
  const pairs: { mediaId: number; a: number; b: number }[] = [];
  const seen = new Set<number>();
  let shared = 0;
  for (const e of theirs) {
    if (seen.has(e.mediaId)) continue;
    seen.add(e.mediaId);
    const raw = mineBy.get(e.mediaId);
    if (raw === undefined) continue;
    shared += 1;
    if (raw > 0 && e.raw > 0) pairs.push({ mediaId: e.mediaId, a: raw, b: e.raw });
  }

  let pearson: number | null = null;
  if (pairs.length >= AFFINITY_MIN_SHARED) {
    const n = pairs.length;
    const meanA = pairs.reduce((s, p) => s + p.a, 0) / n;
    const meanB = pairs.reduce((s, p) => s + p.b, 0) / n;
    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (const p of pairs) {
      cov += (p.a - meanA) * (p.b - meanB);
      varA += (p.a - meanA) ** 2;
      varB += (p.b - meanB) ** 2;
    }
    pearson = varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : null;
  }

  const disagreements = [...pairs]
    .map((p) => ({ mediaId: p.mediaId, mineRaw: p.a, theirsRaw: p.b, diff: p.b - p.a }))
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .filter((d) => d.diff !== 0)
    .slice(0, top);

  return { shared, scoredShared: pairs.length, pearson, disagreements };
}
