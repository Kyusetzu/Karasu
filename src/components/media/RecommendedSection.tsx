import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { recommendationsFor } from "@/api/queries";
import { displayTitle, type MediaListEntry, type MediaType } from "@/api/types";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { pickSeeds, rankRecommendations } from "@/lib/recommend";
import { scoreScale } from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import MediaCard from "@/components/media/MediaCard";

/** Below this the suggestions are too thin to be worth a section. */
const MIN_SEEDS = 3;

/**
 * "Because you finished …" — recommendations aggregated from the user's
 * completed entries. See `lib/recommend.ts` for the ranking.
 *
 * Costs one AniList request, cached for six hours: community recommendations
 * move on the scale of weeks, and the dashboard is the most-visited page in
 * the app, so refetching on the default five-minute staleness would spend
 * rate limit on data that hadn't changed.
 */
export default function RecommendedSection({
  type,
  entries,
}: {
  type: MediaType;
  entries: MediaListEntry[];
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const scoreFormat = useScoreFormat();

  const seeds = useMemo(() => pickSeeds(entries), [entries]);

  // Every id on the list, whatever its status -- built from the list itself
  // rather than from `mediaListEntry`, which is null in local-only mode.
  const exclude = useMemo(
    () => new Set(entries.map((e) => e.mediaId)),
    [entries],
  );

  const titleOf = useMemo(
    () => new Map(entries.map((e) => [e.mediaId, displayTitle(e.media.title)])),
    [entries],
  );

  // Sorted numerically, because this array *is* the cache key. `pickSeeds`
  // orders by score then updatedAt, so editing any completed title reshuffles
  // ties and mints a brand-new key — a fresh AniList request for a
  // byte-identical result, defeating the six-hour staleTime below. The
  // unsorted `seeds` still goes to rankRecommendations, which looks up by id.
  const seedIds = useMemo(
    () => seeds.map((s) => s.mediaId).sort((a, b) => a - b),
    [seeds],
  );
  const { data } = useQuery({
    queryKey: ["recommendations", type, seedIds],
    queryFn: () => recommendationsFor(seedIds),
    enabled: seeds.length >= MIN_SEEDS,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const ranked = useMemo(
    () =>
      data
        ? rankRecommendations(data, {
            seeds,
            exclude,
            type,
            isHidden: (m) => isBlocked(m, level),
            scoreMax: scoreScale(scoreFormat).max,
          })
        : [],
    [data, seeds, exclude, type, level, scoreFormat],
  );

  if (seeds.length < MIN_SEEDS || ranked.length === 0) return null;

  return (
    <section>
      <SectionHeader
        icon={Sparkles}
        title={t(
          type === "ANIME"
            ? "dashboard.recommendedAnime"
            : "dashboard.recommendedManga",
        )}
        meta={t("dashboard.recommendedHint")}
      />
      <div className="mt-4 media-grid gap-y-5 gap-x-4">
        {ranked.map((r) => (
          <div key={r.media.id}>
            <MediaCard media={r.media} />
            <p className="mt-1 line-clamp-2 text-2xs text-ink-600">
              {t("dashboard.becauseYouFinished", {
                title: titleOf.get(r.topSeedId) ?? "?",
              })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
