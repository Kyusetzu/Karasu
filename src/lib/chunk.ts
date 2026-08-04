/**
 * Splits ids into request-sized batches.
 *
 * AniList's `Page` caps at 50 per request and its rate limit is ~30 requests a
 * minute, so the two rules that matter are: never ask for more than a page
 * holds, and never send a request that holds nothing. Both are easy to get
 * subtly wrong inline at a call site, and neither fails loudly — an oversized
 * page silently truncates and an empty one just wastes a request against the
 * limit.
 */
export const PAGE_MAX = 50;

export function chunk<T>(items: readonly T[], size = PAGE_MAX): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The ids to fetch: whatever `wanted` holds that `have` does not.
 *
 * Sorted, because the result is used as a TanStack Query key. `pickSeeds` in
 * `RecommendedSection` learned this the hard way — an unsorted id array
 * reshuffles whenever its source does and mints a fresh cache key each time,
 * so the query refetches forever and the cache never helps.
 */
export function missingIds(
  wanted: readonly number[],
  have: ReadonlySet<number>,
): number[] {
  return [...new Set(wanted.filter((id) => !have.has(id)))].sort((a, b) => a - b);
}
