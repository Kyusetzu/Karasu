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
import { relTimeFromSeconds } from "@/lib/relTime";
import { validatePost } from "@/lib/composer";
import { useSocialActions } from "@/hooks/useSocialActions";
import { useActivityPost } from "@/hooks/useActivityPost";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";

/**
 * One row of the feed.
 *
 * The sentence is translated whole, not assembled from a verb. AniList composes
 * it itself — `"watched episode"` — in English word order and English only, so a
 * German feed read "las Kapitel 162 - 170 Titel" where German wants the
 * participle *after* the title. Each verb owns a full template with a `{{n}}`
 * progress slot and a `%t%` token where the title link goes; `splitSentence`
 * opens the gap and the component drops the `<Link>` in.
 *
 * Still a literal switch over a closed union — `i18nKeys.test.ts` only sees
 * literal `t("…")` calls, and a key built by interpolation would be invisible
 * to it.
 */
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

  // The template path needs a verb this build knows, a title for the slot,
  // and — for the four progress verbs — a parsed progress. Anything else falls
  // back to AniList's own words: slightly untranslated beats a sentence with a
  // hole where the number or title goes.
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

/**
 * The heart is its own receipt and its own undo, which is why a like gets no
 * toast — see `useSocialActions`. A *failed* one does, because that is the case
 * the interface has already claimed succeeded.
 */
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

  // Nothing to like *as* without an account, and a disabled heart is an
  // invitation with no explanation.
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

  return (
    <div className="mt-3 space-y-2 border-l-2 border-surface-800 pl-3">
      {q.isLoading && <Shimmer className="h-3 w-32 rounded" />}
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
      {!q.isLoading && !q.data?.length && (
        <p className="text-2xs text-ink-600">{t("social.noReplies")}</p>
      )}

      {mode === "anilist" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!check.ok || reply.isPending) return;
            reply.mutate(
              { activityId, text: check.text },
              { onSuccess: () => setDraft("") },
            );
          }}
          className="flex items-start gap-2 pt-1"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("social.replyPlaceholder")}
            rows={1}
            className="min-h-8 flex-1 resize-y rounded-lg border border-surface-700 bg-surface-900 px-2 py-1.5 text-xs focus:border-accent-500 focus:outline-none"
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={!check.ok || reply.isPending}
          >
            {reply.isPending ? t("social.posting") : t("social.postReply")}
          </Button>
        </form>
      )}
    </div>
  );
}

export function ActivityCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
  const [repliesOpen, setRepliesOpen] = useState(false);
  const viewer = useAuth((s) => s.viewer);
  const self = viewer !== null && viewer.id === item.user.id;
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
            {/* Your own activity gets the toggle; someone else's pinned one
                gets the passive marker — same glyph, different verbs. */}
            {self ? (
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
            // Text activities are markdown, same dialect as a bio — so the same
            // renderer, which means no innerHTML and no remote images.
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

        {/* One request per expansion, never eagerly — a page of twenty-five
            activities carrying every reply would multiply the payload for rows
            nobody opened. */}
        {repliesOpen && <ActivityReplies activityId={item.id} />}
      </div>
    </article>
  );
}
