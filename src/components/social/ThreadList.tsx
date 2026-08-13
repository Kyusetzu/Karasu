import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import { threads, type ThreadPage } from "@/api/social";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { nextPageParam } from "@/lib/paging";
import { staggerDelay } from "@/lib/motion";
import { ThreadRow } from "./ThreadRow";

/**
 * The threads a user is involved in — ones they started, and ones they replied
 * to.
 *
 * Two lenses rather than one list, because AniList models them as two different
 * arguments (`userId` and `replyUserId`) and there is no way to ask for the
 * union. Chips rather than a segmented control, matching the search page.
 *
 * No remaining count: `pageInfo.total` is the same capped 5000 sentinel as every
 * other paginated thing in this API.
 */
type Lens = "created" | "replied";

export function ThreadList({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  const [lens, setLens] = useState<Lens>("created");

  const q = useInfiniteQuery({
    queryKey: ["social", "threads", userId, lens],
    queryFn: ({ pageParam }) =>
      threads(lens === "created" ? { userId } : { replyUserId: userId }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ThreadPage) => nextPageParam(last.pageInfo),
    enabled: isTauri,
    staleTime: 10 * 60 * 1000,
  });

  const list = (q.data?.pages ?? []).flatMap((p) => p.threads);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["created", "replied"] as const).map((l) => (
          <Pill key={l} active={lens === l} onClick={() => setLens(l)}>
            {l === "created" ? t("social.threadsCreated") : t("social.threadsReplied")}
          </Pill>
        ))}
      </div>

      {q.isLoading && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Shimmer key={i} className="h-20 w-full rounded-xl" index={i} />
          ))}
        </div>
      )}

      {q.error && (
        <p className="text-sm text-danger">
          {t("common.error", { message: String(q.error) })}
        </p>
      )}

      {!q.isLoading && !q.error && list.length === 0 && (
        <EmptyState
          visual={<PerchRule />}
          title={
            lens === "created"
              ? t("social.noThreadsCreated", { name })
              : t("social.noThreadsReplied", { name })
          }
        />
      )}

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
        <Button
          variant="secondary"
          size="sm"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? t("social.loadingMore") : t("social.loadMorePlain")}
        </Button>
      )}
    </div>
  );
}
