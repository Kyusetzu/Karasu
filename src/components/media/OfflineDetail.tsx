import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { displayTitle } from "@/api/types";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { useListMutations } from "@/hooks/useListMutations";


/**
 * What the detail page shows when it cannot reach AniList.
 *
 * It replaced a line of raw text: `Error: Network error: error sending request
 * for url (https://graphql.anilist.co/)`, painted over the whole screen. That
 * is the transport's own sentence, in English, in a German UI, and it said
 * nothing about the one thing worth knowing — that the list you already have
 * is still there.
 *
 * Two states, and the difference is whether the title is on your list. If it
 * is, the list cache already holds the reduced `media` object LIST_QUERY
 * carries, which is enough for the cover, the title and your own progress —
 * and enough for **+1** to work, since a save offline queues and drains later.
 * That was the specific thing a device pass could not do: the page died before
 * the button existed.
 *
 * If it is not on your list there is nothing cached to show, so this says so
 * plainly and offers the retry.
 *
 * Deliberately not a reduced copy of the real page. Everything below the fold
 * there — banner, studios, relations, characters, reviews — comes from
 * `DETAIL_QUERY` and is not cached anywhere; faking a page shape around three
 * fields would promise content that does not exist offline.
 */
export function OfflineDetail({
  mediaId,
  onRetry,
}: {
  mediaId: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const cached = useCachedMedia(mediaId);

  if (!cached) {
    return (
      <div className="p-8">
        <EmptyState
          visual={<WifiOff className="size-8 text-ink-600" />}
          title={t("detail.offlineTitle")}
          hint={t("detail.offlineHint")}
          actions={
            <Button variant="secondary" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <OfflineEntry
      mediaId={mediaId}
      cached={cached}
      onRetry={onRetry}
    />
  );
}

/**
 * Split out because `useListMutations` needs the user id and media type, and
 * both are only known once the cache has answered — a hook cannot be called
 * conditionally in the component above.
 */
function OfflineEntry({
  mediaId,
  cached,
  onRetry,
}: {
  mediaId: number;
  cached: NonNullable<ReturnType<typeof useCachedMedia>>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { entry, mediaType, userId } = cached;
  const { save } = useListMutations(userId, mediaType);
  const total = entry.media.episodes ?? entry.media.chapters ?? null;
  const atEnd = total !== null && entry.progress >= total;

  return (
    <div className="mx-auto max-w-2xl p-8">
      <p className="mb-4 flex items-center gap-2 text-sm text-ink-500">
        <WifiOff className="size-4 shrink-0" />
        {t("detail.offlineCached")}
      </p>

      <div className="flex gap-4 rounded-xl border border-hair bg-surface-900 p-4">
        <div className="h-32 w-22 shrink-0 overflow-hidden rounded-lg bg-surface-800">
          {entry.media.coverImage?.large && (
            <img
              src={entry.media.coverImage.large}
              alt=""
              className="size-full object-cover"
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-lg font-semibold text-ink-100">
            {displayTitle(entry.media.title)}
          </h1>
          <p className="mt-1 text-sm tabular-nums text-ink-500">
            {t("detail.offlineProgress", {
              progress: entry.progress,
              total: total ?? "?",
            })}
          </p>

          <div className="mt-auto flex flex-wrap gap-2 pt-3">
            {/* The one control worth having offline. The save queues and the
                drain sends it — see `save_entry_core`. */}
            <Button
              disabled={atEnd || save.isPending}
              onClick={() =>
                save.mutate({ mediaId, progress: entry.progress + 1 })
              }
            >
              {t("common.plusOne")}
            </Button>
            <Button variant="secondary" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-600">{t("detail.offlineRest")}</p>
    </div>
  );
}
