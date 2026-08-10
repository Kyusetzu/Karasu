/**
 * The arithmetic behind a "Load more" button.
 *
 * Karasu had no pagination anywhere before the social screens: `pageInfo` was
 * queried in two places and never read, and the only "show more" was
 * `RankedList`'s fixed top-25 expand. So this is the whole contract, in one
 * tested place, rather than a condition repeated per tab.
 *
 * Paging is button-driven on purpose, never scroll-driven. The rate limiter in
 * `anilist/client.rs` is a ~30/min brake shared with the scrobbler and the
 * three background alert passes, and it cannot see a burst it has not sent yet
 * — so a feed that fetches because the user scrolled spends that budget with
 * nobody asking it to.
 */

export interface PageInfoLike {
  total?: number | null;
  currentPage?: number | null;
  hasNextPage?: boolean | null;
}

/**
 * The next page number, or `undefined` to stop — the shape `useInfiniteQuery`'s
 * `getNextPageParam` wants.
 *
 * Derived from the response's own `currentPage` rather than a counter kept
 * alongside it: a counter drifts the first time a fetch fails and is retried,
 * and the symptom is a silently skipped page rather than an error.
 */
export function nextPageParam(info: PageInfoLike | null | undefined): number | undefined {
  if (!info || info.hasNextPage !== true) return undefined;
  const current = info.currentPage;
  if (typeof current !== "number" || !Number.isFinite(current) || current < 1) {
    return undefined;
  }
  return current + 1;
}

/**
 * How many rows are still unfetched, for the button's label.
 *
 * **Counts what was fetched, not what is shown.** The content filter runs
 * client-side on other people's content — `Page.activities` and `favourites`
 * take no `isAdult` argument — so a strict-filter user can fetch twenty-five
 * rows and see four. Subtracting the *visible* count would then claim there are
 * twenty-one more to load when the next request will bring nothing new, which
 * is a lie about the rate limit being spent.
 *
 * Clamped at zero: `total` can legitimately fall below what is already loaded
 * when someone unfollows mid-session, and a negative remainder would render.
 */
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
