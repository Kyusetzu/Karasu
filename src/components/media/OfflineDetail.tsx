import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { displayTitle } from "@/api/types";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import { useListMutations } from "@/hooks/useListMutations";


/** The detail page offline: the cached list entry with a working +1, or a plain retry; never a faked page shape. */
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

/** Split out because `useListMutations` needs the cache's answer, and a hook cannot be called conditionally. */
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

      <div className="flex gap-4 rounded-panel border border-hair bg-surface-900 p-4">
        <div className="h-32 w-22 shrink-0 overflow-hidden rounded-control bg-surface-800">
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
