import type { ReactNode } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import type { UserPage } from "@/api/social";
import { Button } from "@/components/ui/button";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { cardClass } from "@/components/ui/card";
import { fetchedCount, nextPageParam, remainingCount } from "@/lib/paging";
import { staggerDelay } from "@/lib/motion";
import { UserRow } from "./UserRow";
import { cn } from "@/lib/utils";

/** Neither `refetch()` nor `maxPages` is used: one refetches every retained page, the other evicts from the far end. */
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
  /** Whether `pageInfo.total` is a real count; false for user search, where it is a capped sentinel. */
  countRemaining?: boolean;
}) {
  const { t } = useTranslation();

  // Paged by a button, never a scroll: `fetchNextPage` on a click, and no `IntersectionObserver` is ever built.
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    // From the response, never a local counter, which drifts on a failed retry and skips a page.
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
            className={cn(cardClass("flat"), "flex items-center gap-3 p-3")}
          >
            <Shimmer className="size-9 rounded-full" index={i} />
            <Shimmer className="h-3 w-32 rounded-inner" index={i} />
          </div>
        ))}
      </div>
    );
  }

  const users = (q.data?.pages ?? []).flatMap((p) => p.users);
  // Only with nothing to show; a later page's failure must not replace the pages being read.
  if (q.error && !users.length && !q.hasNextPage) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

  // Counted from what was fetched, so the label never promises rows a further request cannot bring.
  const pages = q.data?.pages ?? [];
  // Indexed rather than `.at(-1)`; the Linux `safari13` target in `vite.config.ts` has no `Array.prototype.at`.
  const remaining = remainingCount(
    pages.length ? pages[pages.length - 1].pageInfo : undefined,
    fetchedCount(pages),
  );

  // Shared by both returns; AniList serves empty pages with more behind, so the empty state needs the button too.
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
          // Cycles so a late row never waits, and is zero under reduced motion rather than a staggered wait.
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <UserRow user={u} />
        </div>
      ))}

      {footer}
    </div>
  );
}
