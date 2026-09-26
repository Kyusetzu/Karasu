import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
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
  threadCommentTree,
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
import { MarkdownTextarea } from "@/components/social/MarkdownTextarea";
import { CommentTree } from "@/components/social/CommentTree";
import { flattenComments, visibleAnchor, type FlatComment } from "@/lib/comments";
import { nextPageParam } from "@/lib/paging";
import {
  canJump,
  isCommentTarget,
  jumpRoute,
  jumpTarget,
  pageAfterPosting,
  parseCommentParam,
  parsePageInput,
  refreshPlan,
  type JumpRoute,
  type ThreadTarget,
} from "@/lib/threadJump";
import { relTimeFromSeconds } from "@/lib/relTime";
import { validatePost } from "@/lib/composer";
import { displayTitle } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";
import { useSocialActions } from "@/hooks/useSocialActions";
import { cn } from "@/lib/utils";
import { Chip, chipClass } from "@/components/ui/chip";
import { Card } from "@/components/ui/card";

/** The tree route has no pageInfo; keep hasNextPage false so no "Load more" appears under a conversation. */
const EMPTY_PAGE_INFO = { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false };

/** What the jump view came back with, and how it got there. */
interface Newest extends CommentPage {
  /** Which route answered; "comment" is the ?comment= landing through the same uncapped tree field as "tree". */
  via: JumpRoute | "comment";
}

/** The newest reply by the route lib/threadJump picks: the last page, the uncapped tree, or the capped fallback. */
async function fetchNewest(
  threadId: number,
  lastPage: number,
  replyCommentId: number | null,
): Promise<Newest> {
  const deepest = jumpTarget(lastPage).page;
  if (jumpRoute(lastPage, replyCommentId) === "tree") {
    const comments = await threadCommentTree(replyCommentId as number);
    // A deleted newest comment arrives as an empty list, not an error, so fall back to the capped page.
    if (comments.length > 0) {
      return { pageInfo: EMPTY_PAGE_INFO, comments, via: "tree" };
    }
    return { ...(await threadComments(threadId, deepest)), via: "capped" };
  }
  return {
    ...(await threadComments(threadId, deepest)),
    via: jumpRoute(lastPage, replyCommentId),
  };
}

/** One forum thread: its body, its comments, and a box to add one, at two parallel requests cold. */
export default function Thread() {
  const { id = "" } = useParams();
  const threadId = Number(id);
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const { like } = useSocialActions();
  const [draft, setDraft] = useState("");

  const [params, setParams] = useSearchParams();
  const urlComment = parseCommentParam(params.get("comment"));
  // Keep the lazy initializer; set in an effect, page 1 fires first and a ?comment= mount costs a third request.
  const [target, setTarget] = useState<ThreadTarget>(() =>
    urlComment != null ? { comment: urlComment } : null,
  );
  // Adopt a changed param: the page does not remount on a query-string change, so a second comment lands here.
  useEffect(() => {
    if (urlComment == null) return;
    setTarget((t) =>
      isCommentTarget(t) && t.comment === urlComment ? t : { comment: urlComment },
    );
  }, [urlComment]);
  /** Every way of leaving the view clears ?comment= with replace, so the param cannot outlive the view. */
  const changeView = useCallback(
    (next: ThreadTarget) => {
      setTarget(next);
      if (!isCommentTarget(next)) {
        setParams(
          (p) => {
            const q = new URLSearchParams(p);
            q.delete("comment");
            return q;
          },
          { replace: true },
        );
      }
    },
    [setParams],
  );

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
    // Not gated on th.data (that serialized two requests), only off while a ?comment= landing owns the screen.
    enabled:
      isTauri && Number.isFinite(threadId) && threadId > 0 && !isCommentTarget(target),
    // You post into this and read it back, so it goes stale quickly.
    staleTime: 60 * 1000,
  });

  /** The page-number box's draft; one press reaches any readable page where "Load more" would take hundreds. */
  const [pageDraft, setPageDraft] = useState("");
  const lastPage = comments.data?.pages[0]?.pageInfo?.lastPage ?? null;
  /** What the uncapped route resolves — see `fetchNewest`. */
  const replyCommentId = th.data?.replyCommentId ?? null;

  // The jump view is its own query: the infinite cache is contiguous from page 1 and a hole in it renders wrong.
  const newest = useQuery({
    // lastPage and replyCommentId pick the route, so they key the query only while a route is being chosen.
    queryKey: [
      "social",
      "threadJump",
      threadId,
      target,
      ...(target === "newest" ? [lastPage, replyCommentId] : []),
    ],
    queryFn: () => {
      if (isCommentTarget(target)) {
        // The linked comment's whole conversation, uncapped; an empty answer (deleted id) is handled in an effect.
        return threadCommentTree(target.comment).then(
          (comments): Newest => ({ pageInfo: EMPTY_PAGE_INFO, comments, via: "comment" }),
        );
      }
      return target === "newest"
        ? fetchNewest(threadId, lastPage ?? 1, replyCommentId)
        : threadComments(threadId, target as number).then(
            (p): Newest => ({ ...p, via: "page" }),
          );
    },
    // The comment route must not wait for the paged query; a cold ?comment= mount is two requests in parallel.
    enabled:
      isTauri && target != null && (isCommentTarget(target) || lastPage != null),
    staleTime: 60 * 1000,
  });

  /** The deepest page AniList will serve here — the ceiling on the box. */
  const maxPage = lastPage != null ? jumpTarget(lastPage).page : 1;

  const goToPage = () => {
    const page = parsePageInput(pageDraft, maxPage);
    if (page !== null) changeView(page);
  };

  // A deleted linked comment answers an empty tree, not an error; say so and fall back to the paged view.
  useEffect(() => {
    if (!isCommentTarget(target) || newest.data?.via !== "comment") return;
    if (newest.data.comments.length === 0) {
      showToast({ kind: "error", text: t("social.commentGone") });
      changeView(null);
    }
  }, [newest.data, target, changeView, t]);

  /** Which visible row carries the `?comment=` highlight — see `visibleAnchor`. */
  const anchor = useMemo(
    () =>
      isCommentTarget(target) && newest.data?.via === "comment"
        ? visibleAnchor(newest.data.comments, target.comment)
        : null,
    [target, newest.data],
  );

  // Flattened with each comment's page so a reply re-reads its own; memoized since draft re-renders every keystroke.
  const { flat, pageOfComment } = useMemo(() => {
    const pages = comments.data?.pages ?? [];
    const map = new Map<number, number>();
    const rows = pages.flatMap((p, i) => {
      const page = flattenComments(p.comments);
      for (const c of page) map.set(c.id, i);
      return page;
    });
    return { flat: rows, pageOfComment: map };
  }, [comments.data]);
  const newestFlat = useMemo(
    () => flattenComments(newest.data?.comments ?? []),
    [newest.data],
  );

  /** Optimistic like overlay applied after flattening; the raw childComments blob has no cached shape to patch. */
  const [likes, setLikes] = useState<Map<number, { likeCount: number; isLiked: boolean }>>(
    new Map(),
  );
  const applyLikes = useCallback(
    (list: FlatComment[]) => list.map((c) => ({ ...c, ...likes.get(c.id) })),
    [likes],
  );

  /** replyTo positions the box; replyRoot is its top-level ancestor, because a reply under a reply is never drawn. */
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
        // AniList returns the authoritative count; replace the guess so a race with the website resolves.
        if (res) setLikes((m) => new Map(m).set(c.id, { likeCount: res.likeCount, isLiked: res.isLiked }));
      })
      .catch(() => {
        setLikes((m) => new Map(m).set(c.id, now));
        showToast({ kind: "error", text: t("social.likeFailed") });
      });
  };

  const openReply = (c: FlatComment) => {
    const closing = replyTo === c.id;
    setReplyTo(closing ? null : c.id);
    setReplyRoot(closing ? null : c.rootId);
    if (closing) return;
    // Only seed a draft that is empty or a previous prefill, so a second Reply mid-sentence keeps what was typed.
    setReplyDraft((d) =>
      d.trim() === "" || /^@\S+\s*$/.test(d) ? (c.user?.name ? `@${c.user.name} ` : "") : d,
    );
    // Prefill the mention: every reply is parented to the top-level row, so naming who it answers keeps it readable.
    setReplyDraft(c.user?.name ? `@${c.user.name} ` : "");
  };

  /** Re-reads one loaded page and splices it back; comments.refetch() would spend one request per retained page. */
  const rereadPage = useCallback(
    async (index: number) => {
      const cached = qc.getQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>([
        "social",
        "threadComments",
        threadId,
      ]);
      const param = cached?.pageParams[index];
      if (typeof param !== "number") return void comments.refetch();
      const fresh = await threadComments(threadId, param);
      qc.setQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>(
        ["social", "threadComments", threadId],
        (old) =>
          old
            ? { ...old, pages: old.pages.map((p, i) => (i === index ? fresh : p)) }
            : old,
      );
    },
    [qc, threadId, comments],
  );

  const subscribe = useMutation({
    mutationFn: (next: boolean) => toggleThreadSubscription(threadId, next),
    onSuccess: (res) => {
      qc.setQueryData(["social", "thread", threadId], (old: typeof th.data) =>
        old ? { ...old, isSubscribed: res?.isSubscribed ?? !old.isSubscribed } : old,
      );
      // Forget the Subscribed lens (its cache stays fresh across remounts); removing, not invalidating, so it refetches once.
      qc.removeQueries({ queryKey: ["social", "forum", "subscribed"] });
    },
    onError: () => showToast({ kind: "error", text: t("social.subscribeFailed") }),
  });

  const replyMutation = useMutation({
    mutationFn: (vars: { text: string; parentId: number }) =>
      saveThreadComment(threadId, vars.text, vars.parentId),
    // Same non-optimistic rule as the top-level box below, for the same reason.
    onSuccess: (_res, vars) => {
      const parent = vars.parentId;
      setReplyTo(null);
      setReplyRoot(null);
      setReplyDraft("");
      showToast({ kind: "success", text: t("social.replyPosted") });
      // The reply lands in its parent's childComments, so re-read only that page; refetch() re-reads every retained page.
      if (refreshPlan(target) === "jump") {
        void newest.refetch();
        return;
      }
      const idx = pageOfComment.get(parent);
      if (idx === undefined) return void comments.refetch();
      void rereadPage(idx);
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
    // Not optimistic: it is the user's own words, and a failure that erased them would be worse than waiting.
    onSuccess: async () => {
      setDraft("");
      showToast({ kind: "success", text: t("social.commentPosted") });
      // A new comment lands on the last page, never page 1: re-read page 1 for lastPage, then jump there when reachable.
      const first = await threadComments(threadId, 1);
      qc.setQueryData<{ pages: CommentPage[]; pageParams: unknown[] }>(
        ["social", "threadComments", threadId],
        () => ({ pages: [first], pageParams: [1] }),
      );
      const landing = pageAfterPosting(first.pageInfo.lastPage ?? 1);
      if (landing != null && landing > 1) changeView(landing);
    },
    onError: (_e, text) =>
      showToast({
        kind: "error",
        text: t("social.commentFailed"),
        detail: t("social.commentFailedDetail"),
        action: { label: t("common.retry"), run: () => comment.mutate(text) },
      }),
  });

  // One reply box under whichever comment asked for it, shared by both views so the jump view can be answered into.
  const replyBox = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const check = validatePost(replyDraft);
        if (!check.ok || replyRoot == null || replyMutation.isPending) return;
        replyMutation.mutate({ text: check.text, parentId: replyRoot });
      }}
      className="mt-2"
    >
      <MarkdownTextarea
        value={replyDraft}
        onChange={setReplyDraft}
        onSubmit={() => {
          const check = validatePost(replyDraft);
          if (!check.ok || replyRoot == null || replyMutation.isPending) return;
          replyMutation.mutate({ text: check.text, parentId: replyRoot });
        }}
        rows={3}
        autoFocus
        placeholder={t("social.replyPlaceholder")}
        footer={
          <>
            <Button size="sm" type="submit" disabled={!validatePost(replyDraft).ok || replyMutation.isPending}>
              {replyMutation.isPending ? t("social.posting") : t("social.postReply")}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setReplyTo(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      />
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
        <Shimmer className="h-6 w-2/3 rounded-inner" />
        <Shimmer className="h-3 w-40 rounded-inner" index={1} />
        <Shimmer className="h-24 w-full rounded-panel" index={2} />
      </div>
    );
  }

  // Only a not-found rejection means the thread is gone; any other failure is a failure to ask (lib/apiError).
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
  // No like or reply without an account or on a locked thread; a button that can only fail is worse than none.
  const canPost = mode === "anilist" && !data.isLocked;

  return (
    <div className="mx-auto max-w-3xl px-8 pb-12 pt-7">
      <BackButton className="mb-4" />
      <header>
        <div className="flex items-start gap-2">
          {data.isLocked && <Lock className="mt-1.5 size-4 shrink-0 text-ink-600" />}
          <h1 className="min-w-0 flex-1 text-xl text-ink-100">
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
            <MessageSquare className="size-3.5" />
            <span className="tabular-nums">{data.replyCount ?? 0}</span>
          </span>
          <span className="flex items-center gap-1">
            <Eye className="size-3.5" />
            <span className="tabular-nums">{data.viewCount ?? 0}</span>
          </span>
          <button
            onClick={() => like.mutate({ id: data.id, type: "THREAD" })}
            aria-pressed={data.isLiked === true}
            className={cn(
              "flex items-center gap-1 rounded-inner px-1.5 py-0.5 transition-surface hover:bg-surface-850",
              data.isLiked ? "text-danger" : "hover:text-ink-300",
            )}
          >
            <Heart className={cn("size-3.5", data.isLiked && "fill-current")} />
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
              {t("social.openOnAniList")} <ExternalLink className="size-3.5" />
            </button>
          )}
        </div>

        {data.categories && data.categories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.categories.map((c) => (
              <Chip key={c.id} tone="muted" size="xs">
                {c.name}
              </Chip>
            ))}
          </div>
        )}

        {data.mediaCategories && data.mediaCategories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.mediaCategories.map((m) => (
              <Link
                key={m.id}
                to={`/media/${m.id}`}
                className={cn(chipClass("accent", "xs"), "hover:underline")}
              >
                <span className="truncate">{displayTitle(m.title)}</span>
              </Link>
            ))}
          </div>
        )}
      </header>

      {data.body && (
        <Card variant="flat" className="mt-5">
          <Markdown source={data.body} siteUrl={data.siteUrl ?? undefined} />
        </Card>
      )}

      <section className="mt-6">
        {/* Keep `|| target != null`: canJump can turn false mid-jump, and the reader needs a way back out of the jump view. */}
        {(canJump(lastPage) || target != null) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {canJump(lastPage) && (
              <>
                {/* Not disabled while fetching: this is the way out, and a slow request is exactly when it is wanted. */}
                <Button
                  variant={target === "newest" ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => changeView(target === "newest" ? null : "newest")}
                >
                  <ArrowDownToLine className="size-3.5" />
                  {target === "newest"
                    ? t("social.fromTheStart")
                    : t("social.viewNewest")}
                </Button>

            {/* One press to any page, capped at what AniList will serve rather than at lastPage (lib/threadJump). */}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    disabled={newest.isFetching}
                  >
                    {t("social.goToPage")}
                  </Button>
                </form>
              </>
            )}

            {(typeof target === "number" || isCommentTarget(target)) && (
              <Button variant="ghost" size="sm" onClick={() => changeView(null)}>
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
            {newest.isPending ? (
              <div className="space-y-3">
                <Shimmer className="h-16 w-full rounded-panel" />
                <Shimmer className="h-16 w-full rounded-panel" />
              </div>
            ) : newest.error ? (
              <p className="text-sm text-danger">
                {t("common.error", { message: String(newest.error) })}
              </p>
            ) : (
              <>
                {/* Say so whenever the cap decided what arrived: "tree" brings a conversation, "capped" misses the newest. */}
                {newest.data && newest.data.via !== "page" && (
                  <p className="mb-3 rounded-control border border-gold/30 bg-gold/8 px-3 py-2 text-2xs leading-relaxed text-ink-300">
                    {newest.data.via === "comment"
                      ? t(
                          anchor && !anchor.exact
                            ? "social.commentDeeper"
                            : "social.commentContext",
                        )
                      : t(
                          newest.data.via === "tree"
                            ? "social.newestViaTree"
                            : "social.newestCapped",
                          { name: th.data?.replyUser?.name ?? "—" },
                        )}{" "}
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
                  highlightId={anchor?.id}
                >
                  {replyBox}
                </CommentTree>
              </>
            )}
          </>
        ) : (
          <>
            {comments.isLoading && <Shimmer className="h-16 w-full rounded-panel" />}
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
          className="mt-6"
        >
          <MarkdownTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              if (!check.ok || comment.isPending) return;
              comment.mutate(check.text);
            }}
            placeholder={t("social.commentPlaceholder")}
            rows={3}
            preview="toggle"
            previewSource={check.ok ? check.text : ""}
            textareaClassName="min-h-20"
            actions={
              <Button type="submit" size="sm" disabled={!check.ok || comment.isPending}>
                {comment.isPending ? t("social.posting") : t("social.postComment")}
              </Button>
            }
          />
        </form>
      )}
    </div>
  );
}
