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
export function ThreadList({
  queryKey,
  fetchPage,
  emptyTitle,
  emptyHint,
  staleTime = 10 * 60 * 1000,
  enabled = true,
}: {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<ThreadPage>;
  emptyTitle: string;
  emptyHint?: string;
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

  if (q.error) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

  const list = (q.data?.pages ?? []).flatMap((p) => p.threads);
  if (!list.length) {
    return <EmptyState visual={<PerchRule />} title={emptyTitle} hint={emptyHint} />;
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

      {q.hasNextPage && (
        <div className="pt-1">
          <Button
            variant="secondary"
            size="sm"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? t("social.loadingMore") : t("social.loadMorePlain")}
          </Button>
        </div>
      )}
    </div>
  );
}
