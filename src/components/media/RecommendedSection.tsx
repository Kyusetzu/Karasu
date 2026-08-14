import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import {
  recommendationsFor,
  saveRecommendation,
  type RawRecommendationNode,
} from "@/api/queries";
import { displayTitle, type MediaListEntry, type MediaType } from "@/api/types";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import {
  pickSeeds,
  rankRecommendations,
  type ScoredRecommendation,
} from "@/lib/recommend";
import { scoreScale } from "@/lib/scoreFormat";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { showToast } from "@/stores/toast";
import { cn } from "@/lib/utils";
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
            <div className="mt-1 flex items-start justify-between gap-1.5">
              <p className="line-clamp-2 flex-1 text-2xs text-ink-600">
                {t("dashboard.becauseYouFinished", {
                  title: titleOf.get(r.topSeedId) ?? "?",
                })}
              </p>
              <RecVote rec={r} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Up/down on the pairing the caption names — that pairing *is* the
 * recommendation on AniList's side, so the vote lands where the sentence
 * points. Votes feed the community's data; the pressed state is patched
 * into the 6-hour recommendations cache so it survives a remount without a
 * refetch, and clicking the pressed side retracts (NO_RATING).
 */
function RecVote({ rec }: { rec: ScoredRecommendation }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const [vote, setVote] = useState<string | null>(rec.userRating ?? null);
  if (mode !== "anilist") return null;

  const cast = async (rating: "RATE_UP" | "RATE_DOWN") => {
    const next = vote === rating ? "NO_RATING" : rating;
    const previous = vote;
    setVote(next);
    try {
      await saveRecommendation(rec.topSeedId, rec.media.id, next);
      // Keep the long-lived cache honest without spending a refetch.
      qc.setQueriesData<RawRecommendationNode[]>(
        { queryKey: ["recommendations"] },
        (old) =>
          old?.map((n) =>
            n.seedId === rec.topSeedId && n.media.id === rec.media.id
              ? { ...n, userRating: next }
              : n,
          ),
      );
    } catch (e) {
      setVote(previous);
      showToast({ kind: "error", text: t("dashboard.voteFailed"), detail: String(e) });
    }
  };

  const button = (rating: "RATE_UP" | "RATE_DOWN", Icon: typeof ThumbsUp, label: string) => (
    <button
      type="button"
      onClick={() => void cast(rating)}
      aria-pressed={vote === rating}
      aria-label={label}
      title={label}
      className={cn(
        "rounded p-0.5 transition-surface hover:text-ink-100",
        vote === rating ? "text-accent-400" : "text-ink-600",
      )}
    >
      <Icon className="size-3" fill={vote === rating ? "currentColor" : "none"} />
    </button>
  );

  return (
    <span className="flex shrink-0 items-center">
      {button("RATE_UP", ThumbsUp, t("dashboard.voteUp"))}
      {button("RATE_DOWN", ThumbsDown, t("dashboard.voteDown"))}
    </span>
  );
}
