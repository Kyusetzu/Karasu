import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  currentSeason,
  SEASON_LABELS,
  seasonalAnime,
  type Season,
} from "@/api/queries";
import { isTauri } from "@/api/anilist";
import MediaCard from "@/components/MediaCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

function shift(season: Season, year: number, dir: 1 | -1) {
  const idx = SEASONS.indexOf(season) + dir;
  if (idx < 0) return { season: "FALL" as Season, year: year - 1 };
  if (idx > 3) return { season: "WINTER" as Season, year: year + 1 };
  return { season: SEASONS[idx], year };
}

export default function Seasonal() {
  const [{ season, year }, setPeriod] = useState(currentSeason());

  const { data, isLoading, error } = useQuery({
    queryKey: ["seasonal", season, year],
    queryFn: () => seasonalAnime(season, year),
    enabled: isTauri,
    staleTime: 30 * 60 * 1000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Saison</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPeriod((p) => shift(p.season, p.year, -1))}
              aria-label="Vorherige Saison"
            >
              <ChevronLeft size={18} />
            </Button>
            <span className="w-36 text-center text-sm font-semibold">
              {SEASON_LABELS[season]} {year}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPeriod((p) => shift(p.season, p.year, 1))}
              aria-label="Nächste Saison"
            >
              <ChevronRight size={18} />
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
                  ? "bg-accent-600 text-white"
                  : "text-ink-500 hover:bg-surface-800 hover:text-ink-100",
              )}
            >
              {SEASON_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error && <p className="text-sm text-red-300">Fehler: {String(error)}</p>}
        {isLoading && <p className="text-sm text-ink-600">Lade Saison …</p>}
        {data && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
            {data.media.map((m) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
