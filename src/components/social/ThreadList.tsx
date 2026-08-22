import type { ReactNode } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import type { ThreadPage } from "@/api/social";
import { Button } from "@/components/ui/button";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { nextPageParam } from "@/lib/paging";
import { staggerDelay } from "@/lib/motion";
import { ThreadRow } from "./ThreadRow";

/**
 * The one owner of "a paginated list of threads".
 *
 * Same shape as `UserList` and for the same reason: a profile's Forum tab and the
 * forum index would otherwise be two paging implementations that drift. Whoever
 * calls it supplies the key and the fetcher.
 *
 * Never a remaining count. `pageInfo.total` on threads is the capped 5000
 * sentinel this API returns for anything with real content, so the button says
 * "Load more" rather than inventing a number.
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
export function ThreadList({
  queryKey,
  fetchPage,
  emptyTitle,
  emptyHint,
  emptyActions,
  staleTime = 10 * 60 * 1000,
  enabled = true,
}: {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<ThreadPage>;
  emptyTitle: string;
  emptyHint?: string;
  /** Offered when the list is empty — `EmptyState` has always taken these. */
  emptyActions?: ReactNode;
  staleTime?: number;
  enabled?: boolean;
}) {
  const { t } = useTranslation();

  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ThreadPage) => nextPageParam(last.pageInfo),
    enabled: isTauri && enabled,
    staleTime,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-20 w-full rounded-xl" index={i} />
        ))}
      </div>
    );
  }

  const list = (q.data?.pages ?? []).flatMap((p) => p.threads);
  // Only when there is nothing on screen to lose. See the note above.
  if (q.error && !list.length && !q.hasNextPage) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

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
              : t("social.loadMorePlain")}
          </Button>
        </div>
      )}
    </>
  );

  if (!list.length) {
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
      {list.map((th, i) => (
        <div
          key={th.id}
          className="animate-rise-in"
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <ThreadRow thread={th} />
        </div>
      ))}

      {footer}
    </div>
  );
}
