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

/** The one paged thread list; an empty page with more behind it keeps the button, which never carries a count. */
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
  // Only when there is nothing on screen to lose: a failed later page keeps the loaded ones.
  if (q.error && !list.length && !q.hasNextPage) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

  // Shared by the empty and populated returns: an empty page with more behind it needs the button too.
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
