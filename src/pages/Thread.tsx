import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bell, BellOff, ExternalLink, Eye, Heart, Lock, MessageSquare } from "lucide-react";
import {
  saveThreadComment,
  thread as fetchThread,
  threadComments,
  toggleThreadSubscription,
  type CommentPage,
} from "@/api/social";
import { isTauri } from "@/api/anilist";
import BackButton from "@/components/shell/BackButton";
import { Button } from "@/components/ui/button";
import { UserLockup } from "@/components/ui/user-lockup";
import { EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { Markdown } from "@/components/social/Markdown";
import { CommentTree } from "@/components/social/CommentTree";
import { flattenComments } from "@/lib/comments";
import { nextPageParam } from "@/lib/paging";
import { relTimeFromSeconds } from "@/lib/relTime";
import { validatePost } from "@/lib/composer";
import { displayTitle } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";
import { useSocialActions } from "@/hooks/useSocialActions";
import { cn } from "@/lib/utils";

/**
 * One forum thread: its body, its comments, and a box to add one.
 *
 * Two requests cold — the thread and the first page of comments — which is the
 * same cap the profile keeps, and for the same reason.
 *
 * Deliberately reachable by id and from a profile's Forum tab only. A browsable
 * forum index (categories, sort, search, subscriptions) is a second feature with
 * its own rate-limit story, and Karasu is not trying to replace the website's
 * forum.
 */
export default function Thread() {
  const { id = "" } = useParams();
  const threadId = Number(id);
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const { like } = useSocialActions();
  const [draft, setDraft] = useState("");

  const th = useQuery({
    queryKey: ["social", "thread", threadId],
    queryFn: () => fetchThread(threadId),
    enabled: isTauri && Number.isFinite(threadId) && threadId > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const comments = useInfiniteQuery({
    queryKey: ["social", "threadComments", threadId],
    queryFn: ({ pageParam }) => threadComments(threadId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: CommentPage) => nextPageParam(last.pageInfo),
    enabled: isTauri && !!th.data,
    // You post into this and read it back, so it goes stale quickly.
    staleTime: 60 * 1000,
  });

  const subscribe = useMutation({
    mutationFn: (next: boolean) => toggleThreadSubscription(threadId, next),
    onSuccess: (res) => {
      qc.setQueryData(["social", "thread", threadId], (old: typeof th.data) =>
        old ? { ...old, isSubscribed: res?.isSubscribed ?? !old.isSubscribed } : old,
      );
    },
    onError: () => showToast({ kind: "error", text: t("social.subscribeFailed") }),
  });

  const comment = useMutation({
    mutationFn: (text: string) => saveThreadComment(threadId, text),
    // Not optimistic: it is the user's own words, and a failure that erased them
    // would be worse than a moment of waiting.
    onSuccess: () => {
      setDraft("");
      // Only the first page is refetched. `refetch()` on an infinite query
      // refetches *every* retained page, which on a busy thread is a handful of
      // requests to show one new comment.
      qc.setQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>(
        ["social", "threadComments", threadId],
        (old) =>
          old ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) } : old,
      );
      void comments.refetch();
    },
    onError: (_e, text) =>
      showToast({
        kind: "error",
        text: t("social.commentFailed"),
        detail: t("social.commentFailedDetail"),
        action: { label: t("common.retry"), run: () => comment.mutate(text) },
      }),
  });

  if (!Number.isFinite(threadId) || threadId <= 0) {
    return (
      <div className="px-8 pt-7">
        <EmptyState visual={<StruckQuery query={id} />} title={t("social.threadNotFound")} />
      </div>
    );
  }

  if (mode !== "anilist") {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<PerchRule />}
          title={t("social.needsAccount")}
          hint={t("social.needsAccountHint")}
        />
      </div>
    );
  }

  if (th.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-8 pt-7" aria-hidden="true">
        <Shimmer className="h-6 w-2/3 rounded" />
        <Shimmer className="h-3 w-40 rounded" index={1} />
        <Shimmer className="h-24 w-full rounded-xl" index={2} />
      </div>
    );
  }

  if (th.error || !th.data) {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<StruckQuery query={id} />}
          title={t("social.threadNotFound")}
          hint={t("social.threadNotFoundHint")}
        />
      </div>
    );
  }

  const data = th.data;
  const flat = flattenComments((comments.data?.pages ?? []).flatMap((p) => p.comments));
  const check = validatePost(draft);

  return (
    <div className="mx-auto max-w-3xl px-8 pb-12 pt-7">
      <BackButton className="mb-4" />
      <header>
        <div className="flex items-start gap-2">
          {data.isLocked && <Lock className="mt-1.5 size-4 shrink-0 text-ink-600" />}
          <h1 className="min-w-0 flex-1 text-xl font-bold text-ink-100">
            {data.title ?? t("social.untitledThread")}
          </h1>
          <Button
            variant={data.isSubscribed ? "outline" : "secondary"}
            size="sm"
            disabled={subscribe.isPending}
            onClick={() => subscribe.mutate(!data.isSubscribed)}
          >
            {data.isSubscribed ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
            {data.isSubscribed ? t("social.unsubscribe") : t("social.subscribe")}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-600">
          {data.user && (
            <Link to={`/user/${encodeURIComponent(data.user.name)}`}>
              <UserLockup
                name={data.user.name}
                src={data.user.avatar?.medium}
                size="sm"
                nameClassName="text-xs font-medium text-ink-300"
              />
            </Link>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare className="size-2.75" />
            <span className="tabular-nums">{data.replyCount ?? 0}</span>
          </span>
          <span className="flex items-center gap-1">
            <Eye className="size-2.75" />
            <span className="tabular-nums">{data.viewCount ?? 0}</span>
          </span>
          <button
            onClick={() => like.mutate({ id: data.id, type: "THREAD" })}
            aria-pressed={data.isLiked === true}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-surface hover:bg-surface-850",
              data.isLiked ? "text-danger" : "hover:text-ink-300",
            )}
          >
            <Heart className={cn("size-2.75", data.isLiked && "fill-current")} />
            <span className="tabular-nums">{data.likeCount ?? 0}</span>
          </button>
          {data.createdAt && (
            <span>{relTimeFromSeconds(data.createdAt, i18n.language, t("notif.now"))}</span>
          )}
          {data.siteUrl && (
            <button
              onClick={() => void openUrl(data.siteUrl!)}
              className="flex items-center gap-1 text-accent-400 hover:underline"
            >
              {t("social.openOnAniList")} <ExternalLink className="size-2.75" />
            </button>
          )}
        </div>

        {data.categories && data.categories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.categories.map((c) => (
              <span
                key={c.id}
                className="rounded border border-surface-700 px-1.5 py-0.5 text-2xs text-ink-600"
              >
                {c.name}
              </span>
            ))}
          </div>
        )}

        {data.mediaCategories && data.mediaCategories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.mediaCategories.map((m) => (
              <Link
                key={m.id}
                to={`/media/${m.id}`}
                className="rounded border border-accent-600 px-1.5 py-0.5 text-2xs text-accent-400 hover:underline"
              >
                {displayTitle(m.title)}
              </Link>
            ))}
          </div>
        )}
      </header>

      {data.body && (
        <div className="mt-5 rounded-xl border border-surface-800 bg-surface-900 p-4">
          <Markdown source={data.body} siteUrl={data.siteUrl ?? undefined} />
        </div>
      )}

      <section className="mt-6">
        {comments.isLoading && <Shimmer className="h-16 w-full rounded-xl" />}
        {!comments.isLoading && flat.length === 0 && (
          <p className="text-sm text-ink-600">{t("social.noComments")}</p>
        )}
        <CommentTree comments={flat} />

        {comments.hasNextPage && (
          <div className="pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={comments.isFetchingNextPage}
              onClick={() => void comments.fetchNextPage()}
            >
              {comments.isFetchingNextPage
                ? t("social.loadingMore")
                : t("social.loadMorePlain")}
            </Button>
          </div>
        )}
      </section>

      {data.isLocked ? (
        <p className="mt-6 text-xs text-ink-600">{t("social.threadLocked")}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!check.ok || comment.isPending) return;
            comment.mutate(check.text);
          }}
          className="mt-6 space-y-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("social.commentPlaceholder")}
            rows={3}
            className="min-h-20 w-full resize-y rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!check.ok || comment.isPending}>
              {comment.isPending ? t("social.posting") : t("social.postComment")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
