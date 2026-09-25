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

/** Recommendations from completed entries, ranked by `lib/recommend.ts`; cached long, since they move by the week. */
export default function RecommendedSection({
  type,
  entries,
  listUnavailable,
}: {
  type: MediaType;
  entries: MediaListEntry[];
  /** The seed list could not be read; without it an empty `entries` cannot tell too few titles from a dropped request. */
  listUnavailable?: boolean;
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const scoreFormat = useScoreFormat();

  const seeds = useMemo(() => pickSeeds(entries), [entries]);

  // Every id on the list, built from the list itself rather than `mediaListEntry`, which is null in local-only mode.
  const exclude = useMemo(
    () => new Set(entries.map((e) => e.mediaId)),
    [entries],
  );

  const titleOf = useMemo(
    () => new Map(entries.map((e) => [e.mediaId, displayTitle(e.media.title)])),
    [entries],
  );

  // Sorted, since it is the cache key: `pickSeeds` orders by score then updatedAt, so any save would mint a fresh key.
  const seedIds = useMemo(
    () => seeds.map((s) => s.mediaId).sort((a, b) => a - b),
    [seeds],
  );
  const { data, error } = useQuery({
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

  const title = t(
    type === "ANIME"
      ? "dashboard.recommendedAnime"
      : "dashboard.recommendedManga",
  );

  // A failure keeps the heading and says so; the section is absent so often that vanishing reads as nothing to suggest.
  if (error || listUnavailable) {
    return (
      <section>
        <SectionHeader icon={Sparkles} title={title} />
        <p className="mt-3 text-sm text-ink-600">
          {t("dashboard.recommendedUnavailable")}
        </p>
      </section>
    );
  }

  if (seeds.length < MIN_SEEDS || ranked.length === 0) return null;

  return (
    <section>
      <SectionHeader icon={Sparkles} title={title} />
      {/* Not `meta`: that slot is `shrink-0` for short phrases, and this sentence there scrolled the whole page sideways. */}
      <p className="mt-1.5 text-2xs text-ink-600">
        {t("dashboard.recommendedHint")}
      </p>
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

/** Up/down on the pairing the caption names, since that pairing is the recommendation on AniList's side. */
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
        "rounded-inner p-0.5 transition-surface hover:text-ink-100",
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
