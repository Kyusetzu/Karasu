import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Heart, MessageSquare } from "lucide-react";
import type { FeedItem, ActivityVerb } from "@/lib/activity";
import { displayTitle } from "@/api/types";
import { UserLockup } from "@/components/ui/user-lockup";
import { Markdown } from "./Markdown";
import { relTimeFromSeconds } from "@/lib/relTime";

/**
 * One row of the feed.
 *
 * The verb is translated from a key rather than printed from AniList's string.
 * AniList composes the sentence itself — `"watched episode"` — and only in
 * English, so a German feed would otherwise read half-translated. `lib/activity`
 * maps the string to a closed union and this switch turns that into a literal
 * `t("…")` call, which is also what makes `i18nKeys.test.ts` able to see it.
 */
function verbText(verb: ActivityVerb, t: (k: string) => string): string {
  switch (verb) {
    case "watchedEpisode":
      return t("social.verbWatchedEpisode");
    case "rewatchedEpisode":
      return t("social.verbRewatchedEpisode");
    case "readChapter":
      return t("social.verbReadChapter");
    case "rereadChapter":
      return t("social.verbRereadChapter");
    case "completed":
      return t("social.verbCompleted");
    case "plansToWatch":
      return t("social.verbPlansToWatch");
    case "plansToRead":
      return t("social.verbPlansToRead");
    case "dropped":
      return t("social.verbDropped");
    case "paused":
      return t("social.verbPaused");
  }
}

export function ActivityCard({ item }: { item: FeedItem }) {
  const { t, i18n } = useTranslation();
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
          <button
            onClick={() => void openUrl(item.siteUrl)}
            title={t("social.openOnAniList")}
            aria-label={t("social.openOnAniList")}
            className="shrink-0 text-ink-600 transition-surface hover:text-ink-300"
          >
            <ExternalLink className="size-3" />
          </button>
        </div>

        <div className="mt-2 text-sm text-ink-300">
          {item.kind === "list" ? (
            <p>
              {/* An unknown verb falls back to AniList's own words rather than
                  leaving the sentence with a hole in it. */}
              <span>{item.verb ? verbText(item.verb, t) : item.rawStatus}</span>
              {item.progress && (
                <span className="tabular-nums text-ink-100">
                  {" "}
                  {item.progress.to
                    ? `${item.progress.from}–${item.progress.to}`
                    : item.progress.from}
                </span>
              )}
              {item.media && (
                <>
                  {" "}
                  <Link
                    to={`/media/${item.media.id}`}
                    className="text-accent-400 hover:underline"
                  >
                    {displayTitle(item.media.title)}
                  </Link>
                </>
              )}
            </p>
          ) : (
            // Text activities are markdown, same dialect as a bio — so the same
            // renderer, which means no innerHTML and no remote images.
            <Markdown source={item.text} siteUrl={item.siteUrl} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-3 text-2xs text-ink-600">
          <span className="flex items-center gap-1">
            <Heart className="size-2.75" />
            <span className="tabular-nums">{item.likeCount}</span>
          </span>
          {item.replyCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-2.75" />
              <span className="tabular-nums">{item.replyCount}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
