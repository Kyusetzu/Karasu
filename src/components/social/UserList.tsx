import type { ReactNode } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import type { UserPage } from "@/api/social";
import { Button } from "@/components/ui/button";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { fetchedCount, nextPageParam, remainingCount } from "@/lib/paging";
import { staggerDelay } from "@/lib/motion";
import { UserRow } from "./UserRow";

/**
 * The one owner of "a paginated list of people".
 *
 * Followers, following and user search all render through this, so the paging
 * behaviour cannot drift between them — which it would, given three call sites
 * and no shared piece.
 *
 * `useInfiniteQuery` with a **button** as the only trigger. Not scroll-driven:
 * `fetchNextPage` on a click is exactly what the API is for, and the
 * `IntersectionObserver` is simply never built. Rolling the pages into
 * `useState` instead would create a second cache TanStack cannot see or evict.
 *
 * Two traps this avoids, both worth knowing before editing:
 *
 * - **`refetch()` on an infinite query refetches every retained page.** Six
 *   loaded pages, no user action, six requests. Hence the long `staleTime` and
 *   no `refetchOnMount` override anywhere near this.
 * - **`maxPages` looks like the fix for that and is not** — it evicts from the
 *   far end, so a user who loaded six pages scrolls back up to find pages one
 *   and two gone from the list they are reading.
 */
/**
 * The three states a paginated list gets wrong if it renders them naively.
 *
 * 1. **An empty first page with `hasNextPage: true` was a dead end.** Returning
 *    only the empty state means the "Load more" button never renders, so page 2
 *    is unreachable forever — and AniList does serve empty pages with more
 *    behind them. A second, client-side mechanism producing exactly the "my
 *    subscribed threads are empty" symptom.
 * 2. **An error threw away every loaded page.** A failure on page 4 replaced
 *    pages 1–3 — on screen, correct, and being read — with one line of red
 *    text. The bare error is now only for having nothing at all to show.
 * 3. **`EmptyState` takes `actions` and neither list forwarded it**, so an empty
 *    list could not offer the one thing that would fix it.
 */
export function UserList({
  queryKey,
  fetchPage,
  emptyTitle,
  emptyHint,
  emptyActions,
  staleTime = 30 * 60 * 1000,
  enabled = true,
  countRemaining = true,
}: {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<UserPage>;
  emptyTitle: string;
  emptyHint?: string;
  /** Offered when the list is empty — `EmptyState` has always taken these. */
  emptyActions?: ReactNode;
  staleTime?: number;
  enabled?: boolean;
  /**
   * Whether `pageInfo.total` can be believed.
   *
   * False for user search, where AniList reports a capped `total: 5000` with
   * `lastPage: 1000` for anything with many matches — so a count would say
   * "Load 4,975 more" and be inventing the number. Follower and following
   * totals are real.
   */
  countRemaining?: boolean;
}) {
  const { t } = useTranslation();

  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    // From the response, never a local counter — a counter drifts the first
    // time a fetch fails and retries, and the symptom is a skipped page.
    getNextPageParam: (last) => nextPageParam(last.pageInfo),
    enabled: isTauri && enabled,
    staleTime,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-surface-800 p-3"
          >
            <Shimmer className="size-9 rounded-full" index={i} />
            <Shimmer className="h-3 w-32 rounded" index={i} />
          </div>
        ))}
      </div>
    );
  }

  const users = (q.data?.pages ?? []).flatMap((p) => p.users);
  // Only when there is nothing on screen to lose. See the note above.
  if (q.error && !users.length && !q.hasNextPage) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

  // Counted from what was *fetched*, so the label never promises rows a further
  // request cannot bring — see `remainingCount`.
  //
  // Indexed rather than `.at(-1)`: the project targets ES2020, and more to the
  // point `vite.config.ts` builds Linux for `safari13`, where `Array.prototype.at`
  // does not exist and esbuild does not polyfill it. `tsc` caught this, but only
  // because the lib is pinned — worth keeping in mind for anything newer.
  const pages = q.data?.pages ?? [];
  const remaining = remainingCount(
    pages.length ? pages[pages.length - 1].pageInfo : undefined,
    fetchedCount(pages),
  );

  // Shared by the empty and populated returns: both need the button, and the
  // empty one needing it is the whole of point 1 above.
  const footer = (
    <>
      {q.error && (
        <p className="pt-1 text-2xs text-danger">
          {t("common.error", { message: String(q.error) })}
        </p>
      )}
      {q.hasNextPage && (
        <div className="pt-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage
              ? t("social.loadingMore")
              : countRemaining && remaining > 0
                ? t("social.loadMore", { n: remaining })
                : t("social.loadMorePlain")}
          </Button>
        </div>
      )}
    </>
  );

  if (!users.length) {
    return (
      <>
        <EmptyState
          visual={<PerchRule />}
          title={emptyTitle}
          hint={emptyHint}
          actions={emptyActions}
        />
        {footer}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {users.map((u, i) => (
        <div
          key={u.id}
          className="animate-rise-in"
          // Cycles every six, so the fiftieth row does not wait two seconds —
          // and goes to zero under reduced motion rather than becoming a
          // staggered wait.
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <UserRow user={u} />
        </div>
      ))}

      {footer}
    </div>
  );
}
