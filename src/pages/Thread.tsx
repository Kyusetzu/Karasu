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

/**
 * A tree is not a page, and this is what saying so looks like.
 *
 * `threadCommentTree` reaches the newest comment through a root LIST field, so
 * there is no `pageInfo` to report and nothing downstream may act as if there
 * were: `hasNextPage: false` is the load-bearing part, since a "Load more" under
 * a conversation that has no next page would be a button to nowhere.
 */
const EMPTY_PAGE_INFO = { total: 0, currentPage: 1, lastPage: 1, hasNextPage: false };

/** What the jump view came back with, and how it got there. */
interface Newest extends CommentPage {
  /**
   * Which route answered — the copy differs per tier, and a boolean could not
   * carry the outcomes. `"comment"` is the `?comment=` landing: the same
   * uncapped tree field as `"tree"`, fed the linked id instead of the newest.
   */
  via: JumpRoute | "comment";
}

/**
 * The newest reply, by whichever route can actually reach it.
 *
 * **`"page"`** — the thread's own last page, when AniList will serve it. Nearly
 * every thread (thread 2340 is `lastPage: 70`), and it arrives with ten root
 * comments of surrounding conversation.
 *
 * **`"tree"`** — past the 5,000-entry cap. `Thread.replyCommentId` names the
 * newest comment and `threadCommentTree` resolves it through a root LIST field
 * the cap does not apply to, answering with the root of its conversation and
 * everything under it. **One request, at any thread size** — thread 15346 is
 * 70,348 root comments and costs exactly the same as thread 1.
 *
 * This replaced a two-request walk through the last replier's own comments,
 * which worked but returned that person's history rather than the exchange the
 * newest reply belongs to. The screen had to apologise for the difference; now
 * it does not have to.
 *
 * **`"capped"`** — past the cap with nothing to resolve. Lands as deep as
 * allowed and says so.
 *
 * See `lib/threadJump` for the arithmetic, why `sort` cannot do any of this,
 * and what the website does instead.
 */
async function fetchNewest(
  threadId: number,
  lastPage: number,
  replyCommentId: number | null,
): Promise<Newest> {
  const deepest = jumpTarget(lastPage).page;
  if (jumpRoute(lastPage, replyCommentId) === "tree") {
    const comments = await threadCommentTree(replyCommentId as number);
    // A deleted newest comment answers "Not Found." and arrives as an empty
    // list rather than an error, so the capped page is the honest fallback
    // rather than an empty screen under a banner promising the newest reply.
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

  const [params, setParams] = useSearchParams();
  const urlComment = parseCommentParam(params.get("comment"));
  // Lazy initializer, load-bearing: derived in an effect instead, the first
  // render would have `target === null`, the paged query would fire page 1,
  // and a `?comment=` mount would cost a third request.
  const [target, setTarget] = useState<ThreadTarget>(() =>
    urlComment != null ? { comment: urlComment } : null,
  );
  // Adopt a *changed* param: `<main key={pathname}>` does not remount on a
  // query-string change, so the bell navigating to another comment of the
  // same thread lands here rather than in the initializer.
  useEffect(() => {
    if (urlComment == null) return;
    setTarget((t) =>
      isCommentTarget(t) && t.comment === urlComment ? t : { comment: urlComment },
    );
  }, [urlComment]);
  /**
   * Every way of leaving or changing the view goes through this, so the
   * `?comment=` param cannot outlive the view it describes. `replace` keeps
   * history clean: no entry to walk back through, `lib/backStack` untouched,
   * and F5 lands on the comment only while the reader is still looking at it.
   */
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
    // Deliberately *not* gated on `th.data`. It was, and that made a cold
    // thread two round-trips in series — AniList answers in ~1 s warm and much
    // worse cold, so the wait was doubled for nothing. `threadId` comes from
    // the route, so this needs the thread body for exactly no reason.
    //
    // It IS gated off while a `?comment=` landing owns the screen: page 1
    // fetches when the reader leaves that view — a user-initiated moment —
    // keeping the cold comment mount at two requests.
    enabled:
      isTauri && Number.isFinite(threadId) && threadId > 0 && !isCommentTarget(target),
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
  const [pageDraft, setPageDraft] = useState("");
  const lastPage = comments.data?.pages[0]?.pageInfo?.lastPage ?? null;
  /** What the uncapped route resolves — see `fetchNewest`. */
  const replyCommentId = th.data?.replyCommentId ?? null;

  const newest = useQuery({
    // `lastPage` and `replyCommentId` decide the *route*, so they belong to the
    // key only while a route is being chosen. On a numeric target they are
    // noise that re-fetches an unchanged page whenever the thread gains a
    // reply; on a comment target the route is already decided by the id.
    queryKey: [
      "social",
      "threadJump",
      threadId,
      target,
      ...(target === "newest" ? [lastPage, replyCommentId] : []),
    ],
    queryFn: () => {
      if (isCommentTarget(target)) {
        // The linked comment's whole conversation, uncapped — works past the
        // page cap where no page number could. An empty answer (deleted id)
        // is handled by the effect below, not here.
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
    // The comment route needs nothing from the paged query, and must not wait
    // for it — a cold `?comment=` mount is th + tree, in parallel, two
    // requests exactly.
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

  // A deleted (or never-existing) linked comment answers an empty tree, not
  // an error — say so and fall back to the ordinary paged view.
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

  // Memoized because it is not cheap and it ran on *every* render: it walks
  // every retained page and recurses through `childComments` to count what it
  // hides — and `draft` lives in this component, so it re-ran on every
  // keystroke in the reply box.
  // Flattened, plus which loaded page each comment came from. The map is what
  // lets a reply re-read *its own* page instead of collapsing the thread back
  // to page 1, and it is built in the same pass so nothing flattens twice.
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
    const closing = replyTo === c.id;
    setReplyTo(closing ? null : c.id);
    setReplyRoot(closing ? null : c.rootId);
    if (closing) return;
    // Only seed a draft that is empty or is nothing but a previous prefill.
    // It used to overwrite unconditionally, so clicking Reply on a second
    // comment mid-sentence discarded what was typed — twelve lines from a
    // comment saying erasing the user's own words is the thing to avoid.
    setReplyDraft((d) =>
      d.trim() === "" || /^@\S+\s*$/.test(d) ? (c.user?.name ? `@${c.user.name} ` : "") : d,
    );
    // Pre-filled with the mention. Every reply is parented to the top-level
    // row, so an answer to a reply renders beside it rather than under it —
    // naming who it answers is the only thing that keeps that readable.
    setReplyDraft(c.user?.name ? `@${c.user.name} ` : "");
  };

  /**
   * Re-reads one loaded page and splices it back where it was.
   *
   * The alternative is `comments.refetch()`, which re-reads **every** retained
   * page — one request per page out of the ~30/min budget to show one new
   * reply, which is the trap `UserList`'s comment documents.
   */
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
      // The Forum's Subscribed lens is a different query key with a ten-minute
      // `staleTime`, `refetchOnWindowFocus: false` and a thirty-minute
      // `gcTime`, and `/forum` is a separate route — so it unmounts and
      // remounts against a still-fresh cache. Subscribe, go back within ten
      // minutes, and it serves the cached empty page without issuing a
      // request. `NewThreadModal` already does the equivalent after creating a
      // thread, which AniList auto-subscribes you to.
      //
      // `removeQueries`, not `invalidateQueries`: this is an infinite query, so
      // invalidation makes the next mount refetch *every* retained page out of
      // the shared ~30/min budget. Dropping the pages makes it cost one.
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
      // The reply lands inside its parent's `childComments`, so exactly that
      // page has to be re-read — and only that one. This used to truncate the
      // cache to page 1 and refetch, which on a reply made from page 7 threw
      // away six loaded pages, bounced the reader to the top, and did not show
      // the reply. `refetch()` is still avoided: it re-reads *every* retained
      // page, the trap `UserList` documents.
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
    // Not optimistic: it is the user's own words, and a failure that erased them
    // would be worse than a moment of waiting.
    onSuccess: async () => {
      setDraft("");
      showToast({ kind: "success", text: t("social.commentPosted") });
      // A new top-level comment is on the **last** page — comments are
      // oldest-first and `sort` is inert, so it can never be on page 1. This
      // used to re-read page 1 and call it done, which showed the new comment
      // only on a single-page thread.
      //
      // Page 1 is read anyway for a fresh `lastPage`; if the thread has grown
      // past one page, jump to where the comment actually is. Past the 5,000
      // cap `pageAfterPosting` returns null: the comment exists and no page
      // request can reach it, so the reader is left where they are rather than
      // dropped somewhere that implies otherwise.
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
        {/* `|| target != null` so the way back never disappears. These controls
            lived entirely under `canJump`, which reads `lastPage` from the
            *paged* query — so a jump taken while that was known, followed by
            anything that made it unknown, left the reader inside the jump view
            with no button to leave it. */}
        {(canJump(lastPage) || target != null) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {canJump(lastPage) && (
              <>
                {/* Deliberately *not* disabled while fetching: this is the way
                    out, and a slow request is exactly when it is wanted. */}
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
                <Shimmer className="h-16 w-full rounded-xl" />
                <Shimmer className="h-16 w-full rounded-xl" />
              </div>
            ) : newest.error ? (
              <p className="text-sm text-danger">
                {t("common.error", { message: String(newest.error) })}
              </p>
            ) : (
              <>
                {/* Said plainly whenever the cap decided what arrived, because
                    both of those tiers are a different thing from what the
                    button promises. `"tree"` reaches the newest reply exactly
                    but brings its conversation instead of its page; `"capped"`
                    does not reach it at all. Showing either silently would be
                    the lie. */}
                {newest.data && newest.data.via !== "page" && (
                  <p className="mb-3 rounded-lg border border-gold/30 bg-gold/8 px-3 py-2 text-2xs leading-relaxed text-ink-300">
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
