import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Heart, MessageSquare, Pin } from "lucide-react";
import {
  formatProgress,
  PROGRESS_VERBS,
  splitSentence,
  type ActivityVerb,
  type FeedItem,
} from "@/lib/activity";
import { displayTitle } from "@/api/types";
import { isTauri } from "@/api/anilist";
import { activityReplies, type LikeableType } from "@/api/social";
import { UserLockup } from "@/components/ui/user-lockup";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/Skeleton";
import { Markdown } from "./Markdown";
import { MarkdownTextarea } from "./MarkdownTextarea";
import { relTimeFromSeconds } from "@/lib/relTime";
import { validatePost } from "@/lib/composer";
import { canTogglePin } from "@/lib/donator";
import { useSocialActions } from "@/hooks/useSocialActions";
import { useActivityPost } from "@/hooks/useActivityPost";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";

/** A verb's sentence, translated whole; keep the literal switch, `i18nKeys.test.ts` sees only literal `t("…")`. */
function sentenceFor(
  verb: ActivityVerb,
  t: (k: string, o?: { n?: string }) => string,
  n?: string,
): string {
  switch (verb) {
    case "watchedEpisode":
      return t("social.sentWatchedEpisode", { n });
    case "rewatchedEpisode":
      return t("social.sentRewatchedEpisode", { n });
    case "readChapter":
      return t("social.sentReadChapter", { n });
    case "rereadChapter":
      return t("social.sentRereadChapter", { n });
    case "completed":
      return t("social.sentCompleted");
    case "plansToWatch":
      return t("social.sentPlansToWatch");
    case "plansToRead":
      return t("social.sentPlansToRead");
    case "dropped":
      return t("social.sentDropped");
    case "paused":
      return t("social.sentPaused");
  }
}

/** The list-activity sentence, translated whole, with the title link in its slot. */
function ListSentence({ item }: { item: Extract<FeedItem, { kind: "list" }> }) {
  const { t } = useTranslation();

  const titleLink = item.media ? (
    <Link to={`/media/${item.media.id}`} className="text-accent-400 hover:underline">
      {displayTitle(item.media.title)}
    </Link>
  ) : null;

  // Missing a verb, title or needed progress, AniList's own words beat a sentence with a hole in it.
  if (
    item.verb === null ||
    item.media === null ||
    (PROGRESS_VERBS.has(item.verb) && item.progress === null)
  ) {
    return (
      <p>
        <span>{item.rawStatus}</span>
        {item.progress && (
          <span className="tabular-nums text-ink-100"> {formatProgress(item.progress)}</span>
        )}
        {titleLink && <> {titleLink}</>}
      </p>
    );
  }

  const n = item.progress ? formatProgress(item.progress) : undefined;
  const { before, after } = splitSentence(sentenceFor(item.verb, t, n));
  return (
    <p>
      {before}
      {titleLink}
      {after}
    </p>
  );
}

/** The heart is its own receipt and undo, so only a failed like gets a toast; see `useSocialActions`. */
function LikeButton({
  id,
  type,
  activityId,
  likeCount,
  isLiked,
}: {
  id: number;
  type: LikeableType;
  activityId?: number;
  likeCount: number;
  isLiked: boolean;
}) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);
  const { like } = useSocialActions();

  // Nothing to like as without an account, and a disabled heart is an invitation with no explanation.
  if (mode !== "anilist") {
    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-2xs text-ink-600">
        <Heart className="size-2.75" />
        <span className="tabular-nums">{likeCount}</span>
      </span>
    );
  }

  return (
    <button
      onClick={() => like.mutate({ id, type, activityId })}
      aria-pressed={isLiked}
      aria-label={isLiked ? t("social.unlike") : t("social.like")}
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-surface hover:bg-surface-850",
        isLiked ? "text-danger" : "text-ink-600 hover:text-ink-300",
      )}
    >
      <Heart className={cn("size-2.75", isLiked && "fill-current")} />
      <span className="tabular-nums">{likeCount}</span>
    </button>
  );
}

/** The flat reply list AniList returns — one level, which is its own shape. */
function ActivityReplies({ activityId }: { activityId: number }) {
  const { t, i18n } = useTranslation();
  const mode = useAuth((s) => s.mode);
  const { reply } = useSocialActions();
  const [draft, setDraft] = useState("");

  const q = useQuery({
    queryKey: ["social", "activityReplies", activityId],
    queryFn: () => activityReplies(activityId),
    enabled: isTauri,
    staleTime: 60 * 1000,
  });

  const check = validatePost(draft);
  const submitReply = () => {
    if (!check.ok || reply.isPending) return;
    reply.mutate({ activityId, text: check.text }, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="mt-3 space-y-2 border-l-2 border-surface-800 pl-3">
      {q.isLoading && <Shimmer className="h-3 w-32 rounded" />}
      {/* A failed fetch says nothing about the thread, so it must not fall through to "no replies yet". */}
      {q.error && (
        <p className="text-2xs text-danger">{t("social.repliesFailed")}</p>
      )}
      {q.data?.map((r) => (
        <div key={r.id} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <Link
              to={`/user/${encodeURIComponent(r.user?.name ?? "")}`}
              className="min-w-0"
            >
              <UserLockup
                name={r.user?.name ?? "—"}
                src={r.user?.avatar?.medium}
                size="sm"
                nameClassName="text-xs font-medium text-ink-300"
                sub={
                  <span className="block text-2xs text-ink-600">
                    {relTimeFromSeconds(r.createdAt, i18n.language, t("notif.now"))}
                  </span>
                }
              />
            </Link>
            <LikeButton
              id={r.id}
              type="ACTIVITY_REPLY"
              activityId={activityId}
              likeCount={r.likeCount ?? 0}
              isLiked={r.isLiked === true}
            />
          </div>
          <Markdown source={r.text} className="mt-1" />
        </div>
      ))}
      {!q.isLoading && !q.error && !q.data?.length && (
        <p className="text-2xs text-ink-600">{t("social.noReplies")}</p>
      )}

      {mode === "anilist" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitReply();
          }}
          className="pt-1"
        >
          <MarkdownTextarea
            variant="compact"
            value={draft}
            onChange={setDraft}
            onSubmit={submitReply}
            placeholder={t("social.replyPlaceholder")}
            rows={1}
            actions={
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!check.ok || reply.isPending}
              >
                {reply.isPending ? t("social.posting") : t("social.postReply")}
              </Button>
            }
          />
        </form>
      )}
    </div>
  );
}

export function ActivityCard({
  item,
  openReplies = false,
}: {
  item: FeedItem;
  /** Start with the reply thread unfolded — the activity page's case. */
  openReplies?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [repliesOpen, setRepliesOpen] = useState(openReplies);
  const viewer = useAuth((s) => s.viewer);
  const self = viewer !== null && viewer.id === item.user.id;
  // Pinning is a donator feature, so the toggle is offered only where it can succeed; see `lib/donator`.
  const showPin = canTogglePin(viewer, item, self);
  const { pin } = useActivityPost(viewer?.id);
  const when = relTimeFromSeconds(item.createdAt, i18n.language, t("notif.now"));

  return (
    <article className="flex gap-3 rounded-xl border border-surface-800 bg-surface-900 p-3">
      {item.kind === "list" && item.media?.coverImage?.large && (
        <Link
          to={`/media/${item.media.id}`}
          className="w-11 shrink-0"
          title={displayTitle(item.media.title)}
        >
          <img
            src={item.media.coverImage.large}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-2/3 w-full rounded-md object-cover"
          />
        </Link>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/user/${encodeURIComponent(item.user.name)}`} className="min-w-0">
            <UserLockup
              name={item.user.name}
              src={item.user.avatar?.medium}
              size="sm"
              nameClassName="text-xs font-medium text-ink-300"
              sub={<span className="block text-2xs text-ink-600">{when}</span>}
            />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {/* Your own activity gets the toggle if you may pin; anyone's pinned one gets the passive marker. */}
            {showPin ? (
              <button
                onClick={() => pin.mutate({ id: item.id, pinned: !item.isPinned })}
                disabled={pin.isPending}
                aria-pressed={item.isPinned}
                aria-label={item.isPinned ? t("social.unpin") : t("social.pin")}
                title={item.isPinned ? t("social.unpin") : t("social.pin")}
                className={cn(
                  "transition-surface",
                  item.isPinned ? "text-accent-400" : "text-ink-600 hover:text-ink-300",
                )}
              >
                <Pin className={cn("size-3", item.isPinned && "fill-current")} />
              </button>
            ) : (
              item.isPinned && (
                <span title={t("social.pinned")} className="text-accent-400">
                  <Pin className="size-3 fill-current" />
                </span>
              )
            )}
            <button
              onClick={() => void openUrl(item.siteUrl)}
              title={t("social.openOnAniList")}
              aria-label={t("social.openOnAniList")}
              className="text-ink-600 transition-surface hover:text-ink-300"
            >
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>

        <div className="mt-2 text-sm text-ink-300">
          {item.kind === "list" ? (
            <ListSentence item={item} />
          ) : (
            // Text activities are bio markdown, so the same renderer: no innerHTML and no remote images.
            <Markdown source={item.text} siteUrl={item.siteUrl} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-1">
          <LikeButton
            id={item.id}
            type="ACTIVITY"
            likeCount={item.likeCount}
            isLiked={item.isLiked}
          />
          <button
            onClick={() => setRepliesOpen((v) => !v)}
            aria-expanded={repliesOpen}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs transition-surface hover:bg-surface-850",
              repliesOpen ? "text-ink-300" : "text-ink-600 hover:text-ink-300",
            )}
          >
            <MessageSquare className="size-2.75" />
            <span className="tabular-nums">{item.replyCount}</span>
          </button>
        </div>

        {/* One request per expansion, never eagerly, or every row pays for replies nobody opened. */}
        {repliesOpen && <ActivityReplies activityId={item.id} />}
      </div>
    </article>
  );
}
