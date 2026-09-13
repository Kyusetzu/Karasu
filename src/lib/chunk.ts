/** Page-sized id batches: an oversized page silently truncates and an empty one wastes a request. */
export const PAGE_MAX = 50;

export function chunk<T>(items: readonly T[], size = PAGE_MAX): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The ids in `wanted` that `have` lacks, sorted so the query key stays stable when the source reshuffles. */
export function missingIds(
  wanted: readonly number[],
  have: ReadonlySet<number>,
): number[] {
  return [...new Set(wanted.filter((id) => !have.has(id)))].sort((a, b) => a - b);
}
