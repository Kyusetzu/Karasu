import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentSeason, seasonalAnime, type Season } from "@/api/queries";
import { isTauri } from "@/api/anilist";
import MediaCard from "@/components/MediaCard";
import { Button } from "@/components/ui/button";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

function shift(season: Season, year: number, dir: 1 | -1) {
  const idx = SEASONS.indexOf(season) + dir;
  if (idx < 0) return { season: "FALL" as Season, year: year - 1 };
  if (idx > 3) return { season: "WINTER" as Season, year: year + 1 };
  return { season: SEASONS[idx], year };
}

export default function Seasonal() {
  const { t } = useTranslation();
  const [{ season, year }, setPeriod] = useState(currentSeason());

  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);

  const { data, isLoading, error } = useQuery({
    queryKey: ["seasonal", season, year, level],
    queryFn: () => seasonalAnime(season, year, 1, adultQueryArg(level)),
    enabled: isTauri && filterReady,
    staleTime: 30 * 60 * 1000,
  });

  const results = (data?.media ?? []).filter((m) => !isBlocked(m, level));

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("seasonal.title")}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPeriod((p) => shift(p.season, p.year, -1))}
              aria-label={t("seasonal.prev")}
            >
              <ChevronLeft className="size-4.5" />
            </Button>
            <span className="w-36 text-center text-sm font-semibold">
              {t(`season.${season}`)} {year}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPeriod((p) => shift(p.season, p.year, 1))}
              aria-label={t("seasonal.next")}
            >
              <ChevronRight className="size-4.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex gap-1">
          {SEASONS.map((s) => (
            <button
              key={s}
              onClick={() => setPeriod({ season: s, year })}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                s === season
                  ? "bg-accent-600 text-accent-ink"
                  : "text-ink-500 hover:bg-surface-800 hover:text-ink-100",
              )}
            >
              {t(`season.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <p className="text-sm text-danger">
            {t("common.error", { message: String(error) })}
          </p>
        )}
        {isLoading && (
          <p className="text-sm text-ink-600">{t("seasonal.loading")}</p>
        )}
        {!isLoading && !error && results.length === 0 && (
          // Four verticals rather than the schedule's seven: a season is a
          // shorter unit than a week's worth of episodes.
          <EmptyState visual={<TickMarks count={4} />} title={t("seasonal.empty")} />
        )}
        {results.length > 0 && (
          <div className="media-grid gap-x-4 gap-y-6">
            {results.map((m) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
