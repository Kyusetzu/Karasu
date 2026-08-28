import type { ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Heart, MessageSquare } from "lucide-react";
import { isTauri } from "@/api/anilist";
import { userForumComments } from "@/api/social";
import { Button } from "@/components/ui/button";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { renderPlain } from "@/lib/anilistMarkdown";
import { nextPageParam } from "@/lib/paging";
import { relTimeFromSeconds } from "@/lib/relTime";
import { staggerDelay } from "@/lib/motion";

/**
 * One user's forum comments, across every thread, newest first — the surface
 * anilist.co calls "Forum Comments" on a profile.
 *
 * A separate list from `ThreadList` because the rows are a different shape (a
 * comment under its thread's title, not a thread), but the paging discipline
 * is the same one, defects and all: a button and never a scroll, the footer
 * shared by the empty and populated returns so an empty page with more behind
 * it still offers the way forward, and an error that never discards the pages
 * already on screen.
 */
export function UserComments({
  userId,
  emptyTitle,
  emptyActions,
}: {
  userId: number;
  emptyTitle: string;
  emptyActions?: ReactNode;
}) {
  const { t, i18n } = useTranslation();

  const q = useInfiniteQuery({
    queryKey: ["social", "userComments", userId],
    queryFn: ({ pageParam }) => userForumComments(userId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.pageInfo),
    enabled: isTauri && userId > 0,
    staleTime: 10 * 60 * 1000,
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-16 w-full rounded-xl" index={i} />
        ))}
      </div>
    );
  }

  // First occurrence wins: ID_DESC pages shift when comments are posted
  // between fetches, so the last row of one page can reappear on the next —
  // and CLAUDE.md records this field returning perPage+1 rows besides. Either
  // way a repeat would be a duplicate React key.
  const seen = new Set<number>();
  const rows = (q.data?.pages ?? [])
    .flatMap((p) => p.comments)
    .filter((c) => !seen.has(c.id) && (seen.add(c.id), true));

  // Only when there is nothing on screen to lose — the `ThreadList` rule.
  if (q.error && !rows.length && !q.hasNextPage) {
    return (
      <p className="text-sm text-danger">
        {t("common.error", { message: String(q.error) })}
      </p>
    );
  }

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
            {q.isFetchingNextPage ? t("social.loadingMore") : t("social.loadMorePlain")}
          </Button>
        </div>
      )}
    </>
  );

  if (!rows.length) {
    return (
      <>
        <EmptyState
          visual={<PerchRule />}
          title={emptyTitle}
          actions={emptyActions}
        />
        {footer}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((c, i) => (
        <Link
          key={c.id}
          // The comment's own anchor: the thread page resolves it through
          // the uncapped tree field and highlights it. A comment whose
          // thread failed to resolve still renders; the forum index is the
          // least-wrong place for that click to land.
          to={c.thread ? `/thread/${c.thread.id}?comment=${c.id}` : "/forum"}
          className="block animate-rise-in rounded-xl border border-surface-800 p-3 transition-surface hover:border-surface-700 hover:bg-surface-900"
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 shrink-0 text-ink-600" />
            <span className="min-w-0 truncate text-sm font-medium text-ink-200">
              {c.thread?.title ?? t("social.untitledThread")}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3 text-2xs text-ink-600">
              {(c.likeCount ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Heart className="size-3" /> {c.likeCount}
                </span>
              )}
              {c.createdAt != null && relTimeFromSeconds(c.createdAt, i18n.language, t("notif.now"))}
            </span>
          </div>
          {/* The comment itself, flattened to one plain line — markdown markup
              in a snippet reads as noise, and `renderPlain` shares the parser
              so the two can never disagree about what counts as content. */}
          {c.comment && (
            <p className="mt-1.5 line-clamp-2 pl-5.5 text-xs leading-relaxed text-ink-500">
              {renderPlain(c.comment)}
            </p>
          )}
        </Link>
      ))}

      {footer}
    </div>
  );
}
