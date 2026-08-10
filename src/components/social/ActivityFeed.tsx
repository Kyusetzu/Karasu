import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/api/anilist";
import { activities, type ActivityPage } from "@/api/social";
import { Button } from "@/components/ui/button";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { normalizeActivity, type FeedItem } from "@/lib/activity";
import { nextPageParam } from "@/lib/paging";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { staggerDelay } from "@/lib/motion";
import { ActivityCard } from "./ActivityCard";

/**
 * A paginated activity feed — a profile's own, or everyone the viewer follows.
 *
 * Never shows a remaining count. AniList reports `total: 5000` with
 * `lastPage: 500` for any feed with real content, exactly as it does for user
 * search, so a number on the button would be invented. `UserList` carries the
 * same caveat as a flag; here it is simply never shown.
 *
 * Button-driven, like every other paged list in the app: the limiter shared with
 * the scrobbler and the alert passes cannot see a burst it has not sent, so
 * spending a request is always something the user did.
 */
export function ActivityFeed({
  queryKey,
  source,
  emptyTitle,
  emptyHint,
}: {
  queryKey: QueryKey;
  source: { userId: number } | { isFollowing: true };
  emptyTitle: string;
  emptyHint?: string;
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);

  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => activities(source, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: ActivityPage) => nextPageParam(last.pageInfo),
    enabled: isTauri,
    staleTime: 2 * 60 * 1000,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 rounded-xl border border-surface-800 p-3">
            <Shimmer className="aspect-2/3 w-11 rounded-md" index={i} />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-3 w-28 rounded" index={i} />
              <Shimmer className="h-3 w-full rounded" index={i + 1} />
            </div>
          </div>
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

  // `normalizeActivity` drops private messages and anything unrecognised; the
  // content filter then runs on other people's media, which `Page.activities`
  // gives no server-side argument for.
  const items: FeedItem[] = (q.data?.pages ?? [])
    .flatMap((p) => p.activities)
    .map((raw) => normalizeActivity(raw as Parameters<typeof normalizeActivity>[0]))
    .filter((i): i is FeedItem => i !== null)
    .filter((i) => (i.kind === "list" && i.media ? !isBlocked(i.media, level) : true));

  if (!items.length) {
    return <EmptyState visual={<PerchRule />} title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div
          key={`${item.kind}-${item.id}`}
          className="animate-rise-in"
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <ActivityCard item={item} />
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
