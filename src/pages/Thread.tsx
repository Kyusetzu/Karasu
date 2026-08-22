import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownToLine,
  Bell,
  BellOff,
  ExternalLink,
  Eye,
  Heart,
  Lock,
  MessageSquare,
} from "lucide-react";
import {
  saveThreadComment,
  thread as fetchThread,
  threadComments,
  toggleLike,
  toggleThreadSubscription,
  type CommentPage,
} from "@/api/social";
import { isTauri } from "@/api/anilist";
import BackButton from "@/components/shell/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserLockup } from "@/components/ui/user-lockup";
import { EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { isNotFound } from "@/lib/apiError";
import { Shimmer } from "@/components/Skeleton";
import { Markdown } from "@/components/social/Markdown";
import { CommentTree } from "@/components/social/CommentTree";
import { flattenComments, type FlatComment } from "@/lib/comments";
import { nextPageParam } from "@/lib/paging";
import { canJump, jumpTarget } from "@/lib/threadJump";
import { relTimeFromSeconds } from "@/lib/relTime";
import { validatePost } from "@/lib/composer";
import { displayTitle } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";
import { useSocialActions } from "@/hooks/useSocialActions";
import { cn } from "@/lib/utils";

/** What the newest-reply jump came back with, and how it got there. */
interface Newest extends CommentPage {
  /** True when the second tier was needed — the copy differs. */
  viaAuthor: boolean;
}

/**
 * The newest reply, in one tier or two.
 *
 * **Tier 1** — the thread's own last page, when AniList will serve it. That is
 * nearly every thread (your thread 2340 is `lastPage: 70`) and it comes with
 * the surrounding conversation, which is what you actually want to read.
 *
 * **Tier 2** — when the 5,000-entry cap puts the end out of reach. Thread 1 is
 * the case: `lastPage: 703`, and page 500 — the deepest that answers — ends in
 * 2021 while the thread was replied to today. So it goes at the newest comment
 * through its *author* instead: `threadComments(threadId, userId:)` narrows to
 * the last replier's own comments, 123 of them there, well inside the cap, and
 * that set's final page holds the comment `repliedAt` refers to. Two requests,
 * behind an explicit press.
 *
 * See `lib/threadJump` for the arithmetic and why `sort` cannot do any of this.
 */
async function fetchNewest(
  threadId: number,
  lastPage: number,
  replyUserId: number | null,
): Promise<Newest> {
  const target = jumpTarget(lastPage);
  if (target.reachable) {
    return { ...(await threadComments(threadId, target.page)), viaAuthor: false };
  }
  // Past the cap. Without an author to narrow by there is nothing better to do
  // than land as deep as allowed, and the caller says so on screen.
  if (replyUserId == null) {
    return { ...(await threadComments(threadId, target.page)), viaAuthor: false };
  }
  const first = await threadComments(threadId, 1, replyUserId);
  const authorEnd = jumpTarget(first.pageInfo.lastPage ?? 1);
  // One page of theirs is the whole set — no second request needed.
  if (authorEnd.page <= 1) return { ...first, viaAuthor: true };
  return {
    ...(await threadComments(threadId, authorEnd.page, replyUserId)),
    viaAuthor: true,
  };
}

/**
 * One forum thread: its body, its comments, and a box to add one.
 *
 * Two requests cold — the thread and the first page of comments — issued *in
 * parallel*, which they were not: the comments used to wait for the thread body
 * they do not need.
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
    // Deliberately *not* gated on `th.data`. It was, and that made a cold
    // thread two round-trips in series — AniList answers in ~1 s warm and much
    // worse cold, so the wait was doubled for nothing. `threadId` comes from
    // the route, so this needs the thread body for exactly no reason.
    enabled: isTauri && Number.isFinite(threadId) && threadId > 0,
    // You post into this and read it back, so it goes stale quickly.
    staleTime: 60 * 1000,
  });

  // The newest reply, on demand. Its own query rather than pages appended to
  // the infinite one above: that cache is contiguous from page 1, and dropping
  // page 70 into it would leave a hole nothing renders correctly.
  /**
   * Which comments are on screen: the normal paged read (`null`), the
   * newest-reply jump, or one page asked for by number.
   *
   * A page number is the practical half of the 5,000-entry cap. On a long
   * thread the deepest *readable* comment is hundreds of "Load more" presses
   * away, and pressing a button five hundred times is not a feature — this
   * reaches it in one, and reaches anywhere else in one too.
   */
  const [target, setTarget] = useState<"newest" | number | null>(null);
  const [pageDraft, setPageDraft] = useState("");
  const lastPage = comments.data?.pages[0]?.pageInfo?.lastPage ?? null;
  const replyUserId = th.data?.replyUser?.id ?? null;

  const newest = useQuery({
    queryKey: ["social", "threadJump", threadId, target, lastPage, replyUserId],
    queryFn: () =>
      target === "newest"
        ? fetchNewest(threadId, lastPage ?? 1, replyUserId)
        : threadComments(threadId, target as number).then((p) => ({
            ...p,
            viaAuthor: false,
          })),
    enabled: isTauri && target != null && lastPage != null,
    staleTime: 60 * 1000,
  });

  /** The deepest page AniList will serve here — the ceiling on the box. */
  const maxPage = lastPage != null ? jumpTarget(lastPage).page : 1;

  const goToPage = () => {
    const n = Number(pageDraft);
    if (!Number.isFinite(n)) return;
    setTarget(Math.min(Math.max(Math.trunc(n), 1), maxPage));
  };

  // Memoized because it is not cheap and it ran on *every* render: it walks
  // every retained page and recurses through `childComments` to count what it
  // hides — and `draft` lives in this component, so it re-ran on every
  // keystroke in the reply box.
  const flat = useMemo(
    () => flattenComments((comments.data?.pages ?? []).flatMap((p) => p.comments)),
    [comments.data],
  );
  const newestFlat = useMemo(
    () => flattenComments(newest.data?.comments ?? []),
    [newest.data],
  );

  /**
   * Optimistic like state for comments, kept here rather than in the query
   * cache.
   *
   * Thread comments arrive inside a raw `childComments` JSON blob that
   * `lib/comments` flattens on read, so there is no tidy cached shape to patch
   * — and `useSocialActions` deliberately skips `THREAD_COMMENT` for exactly
   * that reason. An overlay applied after flattening is the honest version:
   * it survives a re-render, and it is dropped the moment the page unmounts,
   * which is also when the cache it is overlaying goes.
   */
  const [likes, setLikes] = useState<Map<number, { likeCount: number; isLiked: boolean }>>(
    new Map(),
  );
  const applyLikes = useCallback(
    (list: FlatComment[]) => list.map((c) => ({ ...c, ...(likes.get(c.id) ?? {}) })),
    [likes],
  );

  /**
   * Which comment the box is open under, and which row a reply is parented to.
   *
   * They are not the same number. `replyTo` is the row that was pressed — it
   * positions the box — while `replyRoot` is that row's top-level ancestor,
   * which is what AniList must be given. Parenting to a *reply* creates a
   * depth-2 comment that `flattenComments` never draws, so the post succeeds
   * and disappears.
   */
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyRoot, setReplyRoot] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  const likeComment = (c: FlatComment) => {
    const now = likes.get(c.id) ?? { likeCount: c.likeCount, isLiked: c.isLiked };
    const next = {
      likeCount: now.likeCount + (now.isLiked ? -1 : 1),
      isLiked: !now.isLiked,
    };
    setLikes((m) => new Map(m).set(c.id, next));
    toggleLike(c.id, "THREAD_COMMENT")
      .then((res) => {
        // AniList returns the authoritative count; replace the guess rather
        // than keeping it, which is where a race with the website resolves.
        if (res) setLikes((m) => new Map(m).set(c.id, { likeCount: res.likeCount, isLiked: res.isLiked }));
      })
      .catch(() => {
        setLikes((m) => new Map(m).set(c.id, now));
        showToast({ kind: "error", text: t("social.likeFailed") });
      });
  };

  const openReply = (c: FlatComment) => {
    setReplyTo((open) => (open === c.id ? null : c.id));
    setReplyRoot(c.rootId);
    // Pre-filled with the mention. Every reply is parented to the top-level
    // row, so an answer to a reply renders beside it rather than under it —
    // naming who it answers is the only thing that keeps that readable.
    setReplyDraft(c.user?.name ? `@${c.user.name} ` : "");
  };

  const subscribe = useMutation({
    mutationFn: (next: boolean) => toggleThreadSubscription(threadId, next),
    onSuccess: (res) => {
      qc.setQueryData(["social", "thread", threadId], (old: typeof th.data) =>
        old ? { ...old, isSubscribed: res?.isSubscribed ?? !old.isSubscribed } : old,
      );
    },
    onError: () => showToast({ kind: "error", text: t("social.subscribeFailed") }),
  });

  const replyMutation = useMutation({
    mutationFn: (vars: { text: string; parentId: number }) =>
      saveThreadComment(threadId, vars.text, vars.parentId),
    // Same non-optimistic rule as the top-level box below, for the same reason.
    onSuccess: () => {
      setReplyTo(null);
      setReplyRoot(null);
      setReplyDraft("");
      // The reply lands inside its parent's `childComments`, so the page it is
      // on has to be re-read. Page 1 only — `refetch()` would re-read every
      // retained page, which on a long thread is a handful of requests.
      qc.setQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>(
        ["social", "threadComments", threadId],
        (old) =>
          old ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) } : old,
      );
      void comments.refetch();
      void newest.refetch();
    },
    onError: () =>
      showToast({
        kind: "error",
        text: t("social.commentFailed"),
        detail: t("social.commentFailedDetail"),
      }),
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

  // One reply box, rendered under whichever comment asked for it. Shared by
  // both views, so the newest-replies jump can be answered into as well.
  const replyBox = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const check = validatePost(replyDraft);
        if (!check.ok || replyRoot == null || replyMutation.isPending) return;
        replyMutation.mutate({ text: check.text, parentId: replyRoot });
      }}
      className="mt-2 space-y-1.5"
    >
      <textarea
        value={replyDraft}
        onChange={(e) => setReplyDraft(e.target.value)}
        rows={3}
        autoFocus
        placeholder={t("social.replyPlaceholder")}
        className="w-full resize-y rounded-lg border border-surface-700 bg-surface-950 p-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={!validatePost(replyDraft).ok || replyMutation.isPending}>
          {replyMutation.isPending ? t("social.posting") : t("social.postReply")}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setReplyTo(null)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );

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

  // A rejection is only "does not exist" when it says so. Anything else — an
  // expired token, a rate limit, no connection — is a failure to ask, and
  // asserting the thread is gone because the network is down is a definite
  // claim about someone else's data. See `lib/apiError`.
  if (th.error && !isNotFound(th.error)) {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<StruckQuery query={id} />}
          title={t("common.error", { message: String(th.error) })}
          actions={
            <Button variant="outline" size="control" onClick={() => void th.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
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
  const check = validatePost(draft);
  // No like or reply affordance without an account or on a locked thread — a
  // button that can only fail is worse than no button.
  const canPost = mode === "anilist" && !data.isLocked;

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
        {/* Page 1 is the oldest and there is no way to reverse that — see
            `lib/threadJump`. So on any thread past one page, the newest reply
            is somewhere the reader cannot get to by scrolling. */}
        {canJump(lastPage) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              variant={target === "newest" ? "outline" : "secondary"}
              size="sm"
              disabled={newest.isFetching}
              onClick={() => setTarget((v) => (v === "newest" ? null : "newest"))}
            >
              <ArrowDownToLine className="size-3.5" />
              {target === "newest" ? t("social.fromTheStart") : t("social.viewNewest")}
            </Button>

            {/* One press to anywhere, including the deepest readable page.
                Capped at what AniList will actually serve rather than at
                `lastPage`, which on a big thread is a number you cannot ask
                for — see `lib/threadJump`. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                goToPage();
              }}
              className="flex items-center gap-1.5"
            >
              <label className="text-2xs text-ink-600" htmlFor="thread-page">
                {t("social.pageOf", { max: maxPage })}
              </label>
              <Input
                id="thread-page"
                type="number"
                min={1}
                max={maxPage}
                value={pageDraft}
                onChange={(e) => setPageDraft(e.target.value)}
                className="w-20"
              />
              <Button variant="ghost" size="sm" type="submit" disabled={newest.isFetching}>
                {t("social.goToPage")}
              </Button>
            </form>

            {typeof target === "number" && (
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                {t("social.fromTheStart")}
              </Button>
            )}
            {newest.isFetching && (
              <span className="text-2xs text-ink-600">{t("social.jumping")}</span>
            )}
          </div>
        )}

        {target != null ? (
          <>
            {newest.isPending || newest.isFetching ? (
              <div className="space-y-3">
                <Shimmer className="h-16 w-full rounded-xl" />
                <Shimmer className="h-16 w-full rounded-xl" />
              </div>
            ) : newest.error ? (
              <p className="text-sm text-danger">
                {t("common.error", { message: String(newest.error) })}
              </p>
            ) : (
              <>
                {/* Said plainly, because tier 2 is a different thing from what
                    the button promises: one person's recent comments rather
                    than the tail of the conversation. Silently showing the
                    narrower view would be the lie. */}
                {newest.data?.viaAuthor && (
                  <p className="mb-3 rounded-lg border border-gold/30 bg-gold/8 px-3 py-2 text-2xs leading-relaxed text-ink-300">
                    {t("social.newestViaAuthor", {
                      name: th.data?.replyUser?.name ?? "—",
                    })}{" "}
                    {data.siteUrl && (
                      <button
                        onClick={() => void openUrl(data.siteUrl!)}
                        className="text-accent-400 hover:underline"
                      >
                        {t("social.openOnAniList")}
                      </button>
                    )}
                  </p>
                )}
                <CommentTree
                  comments={applyLikes(newestFlat)}
                  onLike={canPost ? likeComment : undefined}
                  onReply={canPost ? openReply : undefined}
                  replyingTo={replyTo}
                >
                  {replyBox}
                </CommentTree>
              </>
            )}
          </>
        ) : (
          <>
            {comments.isLoading && <Shimmer className="h-16 w-full rounded-xl" />}
            {!comments.isLoading && flat.length === 0 && (
              <p className="text-sm text-ink-600">{t("social.noComments")}</p>
            )}
            <CommentTree
              comments={applyLikes(flat)}
              onLike={canPost ? likeComment : undefined}
              onReply={canPost ? openReply : undefined}
              replyingTo={replyTo}
            >
              {replyBox}
            </CommentTree>

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
          </>
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
