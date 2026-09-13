/** The arithmetic behind "Load more"; paging is a button, never a scroll, because the limiter cannot see a burst. */

export interface PageInfoLike {
  total?: number | null;
  currentPage?: number | null;
  hasNextPage?: boolean | null;
}

/** The next page for `getNextPageParam`, from the response's own `currentPage` because a local counter drifts on retry. */
export function nextPageParam(info: PageInfoLike | null | undefined): number | undefined {
  if (!info || info.hasNextPage !== true) return undefined;
  const current = info.currentPage;
  if (typeof current !== "number" || !Number.isFinite(current) || current < 1) {
    return undefined;
  }
  return current + 1;
}

/** Rows still unfetched, counted against fetched rather than shown, because the content filter hides rows client-side. */
export function remainingCount(
  info: PageInfoLike | null | undefined,
  fetched: number,
): number {
  const total = info?.total;
  if (typeof total !== "number" || !Number.isFinite(total)) return 0;
  return Math.max(0, total - fetched);
}

/** Total rows fetched across every loaded page of an infinite query. */
export function fetchedCount<T>(pages: { users?: T[]; items?: T[] }[] | undefined): number {
  if (!pages) return 0;
  return pages.reduce((n, p) => n + (p.users?.length ?? p.items?.length ?? 0), 0);
}
