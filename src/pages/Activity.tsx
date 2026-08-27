import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { singleActivity } from "@/api/social";
import { normalizeActivity, type RawActivity } from "@/lib/activity";
import { ActivityCard } from "@/components/social/ActivityCard";
import BackButton from "@/components/shell/BackButton";
import { EmptyState, StruckQuery } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";

/**
 * One activity, on its own page — where the bell's activity notifications
 * land, and where an `anilist.co/activity/N` link points now that
 * `internalRoute` maps it. The card is the feed's own `ActivityCard`, replies
 * open, so this page never grows a second way of drawing an activity.
 *
 * A deleted id answers "Not Found." and a `MessageActivity` normalises to
 * null (private mail, refused everywhere) — both read as the same gone-state
 * on purpose: naming the second would advertise what it is.
 */
export default function Activity() {
  const { t } = useTranslation();
  const { id } = useParams();
  const level = useContentFilter((s) => s.level);
  const activityId = Number(id);

  const query = useQuery({
    queryKey: ["social", "activity", activityId],
    queryFn: () => singleActivity(activityId),
    enabled: Number.isFinite(activityId),
    staleTime: 60_000,
  });

  const item =
    query.data != null ? normalizeActivity(query.data as RawActivity) : null;
  const filtered =
    item?.kind === "list" && isBlocked(item.media, level);

  return (
    <div className="mx-auto max-w-2xl px-8 pb-12 pt-6">
      <BackButton />
      <div className="mt-4">
        {query.isLoading && <Shimmer className="h-28 w-full rounded-xl" />}
        {!query.isLoading && filtered && (
          <div className="py-10 text-center">
            <p className="text-sm text-ink-300">{t("detail.filtered")}</p>
            <Link
              to="/settings?pane=appearance"
              className="mt-1 inline-block text-xs text-accent-400 hover:underline"
            >
              {t("detail.filteredHint")}
            </Link>
          </div>
        )}
        {!query.isLoading && !filtered && (
          item ? (
            <ActivityCard item={item} openReplies />
          ) : (
            <EmptyState
              visual={<StruckQuery query={`#${id ?? ""}`} />}
              title={t("social.activityGone")}
            />
          )
        )}
      </div>
    </div>
  );
}
