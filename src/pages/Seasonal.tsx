import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useColumnCount } from "@/hooks/useColumnCount";
import { useGridRoving } from "@/hooks/useGridRoving";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Disc3,
  Film,
  MonitorPlay,
  Shapes,
  Sparkles,
  Timer,
  Tv,
} from "lucide-react";
import { currentSeason, seasonalAnime, type Season } from "@/api/queries";
import { isTauri } from "@/api/anilist";
import MediaCard from "@/components/media/MediaCard";
import SeasonPicker from "@/components/ui/season-picker";
import { Button } from "@/components/ui/button";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { SectionHeader } from "@/components/ui/section-header";
import { flattenGroups, groupByFormat } from "@/lib/formatGroups";
import { formatLabel } from "@/lib/format";

/** One glyph per format, so the sections are scannable without reading. */
const FORMAT_ICON: Record<string, typeof Tv> = {
  TV: Tv,
  MOVIE: Film,
  TV_SHORT: Timer,
  SPECIAL: Sparkles,
  OVA: Disc3,
  ONA: MonitorPlay,
  MUSIC: Clapperboard,
};

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

  // Grouped by format, then flattened back: the roving index counts over the
  // order the eye reads, not the order AniList sent. Fifty items and no
  // virtualization, so a section is simply another `media-grid`.
  const groups = useMemo(
    () => groupByFormat((data?.media ?? []).filter((m) => !isBlocked(m, level))),
    [data, level],
  );
  const results = useMemo(() => flattenGroups(groups), [groups]);
  const sections = useMemo(() => groups.map((g) => g.items.length), [groups]);

  // Arrow keys over the wall of cards, the same movement and the same
  // ownership rule the list view uses. `useColumnCount` reads the browser's
  // resolved `grid-template-columns` rather than recomputing the CSS here,
  // which is what keeps it right across a breakpoint and a cover-size change.
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount(gridRef, results.length);
  const navigate = useNavigate();
  const { focus } = useGridRoving({
    count: results.length,
    columns,
    sections,
    onOpen: (i) => {
      const m = results[i];
      if (m) navigate(`/media/${m.id}`);
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="sr-only">{t("seasonal.title")}</h1>
        <div className="flex items-center gap-2">
          <SeasonPicker season={season} year={year} onPick={setPeriod} />
          <span className="section-rule" />
          <Button
            variant="ghost"
            size="iconControl"
            onClick={() => setPeriod((p) => shift(p.season, p.year, -1))}
            aria-label={t("seasonal.prev")}
          >
            <ChevronLeft className="size-4.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconControl"
            onClick={() => setPeriod((p) => shift(p.season, p.year, 1))}
            aria-label={t("seasonal.next")}
          >
            <ChevronRight className="size-4.5" />
          </Button>
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
        {groups.length > 0 && (
          <div className="space-y-7">
            {groups.map((group) => (
              <section key={group.format ?? "other"}>
                <SectionHeader
                  icon={FORMAT_ICON[group.format ?? ""] ?? Shapes}
                  title={
                    group.format
                      ? formatLabel(group.format, t)
                      : t("seasonal.otherFormats")
                  }
                  meta={String(group.items.length)}
                  className="mb-3"
                />
                {/* The measured grid is the first section's. Every section uses
                    the same `media-grid` track, so one probe answers for all of
                    them — and `useColumnCount` needs an element that is
                    actually laid out. */}
                <div
                  ref={group.offset === 0 ? gridRef : undefined}
                  className="media-grid gap-x-4 gap-y-6"
                >
                  {group.items.map((m, i) => (
                    <MediaCard
                      key={m.id}
                      media={m}
                      focused={group.offset + i === focus}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
