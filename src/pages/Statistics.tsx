import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart3, ExternalLink, Sparkles } from "lucide-react";
import {
  userStatistics,
  type AnimeStats,
  type Distribution,
  type MangaStats,
  type StatEntry,
} from "@/api/queries";
import { fetchMediaList, isTauri } from "@/api/anilist";
import type { MediaType } from "@/api/types";
import { formatMinutes, remainingMinutes } from "@/lib/estimate";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import {
  isBlocked,
  isBlockedGenre,
  type ContentFilterLevel,
} from "@/lib/contentFilter";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/user-lockup";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import {
  LineChart,
  RadarChart,
  Sunburst,
  ToneLegend,
  Treemap,
  type Slice,
} from "@/components/stats/Charts";
import { STATUS_ORDER, type MediaListStatus } from "@/api/types";
import { Empty, type Category } from "@/components/stats/shared";
import { DistributionCard, ScoreColumns, StatusBar, TileGrid, YearSparkline } from "@/components/stats/panels";
import { RankedList, fmt, scoreText } from "@/components/stats/RankedList";
const ANIME_CATEGORIES: Category[] = [
  "overview",
  "genres",
  "tags",
  "voiceActors",
  "studios",
  "staff",
];

const MANGA_CATEGORIES: Category[] = ["overview", "genres", "tags", "staff"];

export default function Statistics() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">{t("stats.title")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            {t("stats.signInText")}
          </p>
          <Link to="/settings">
            <Button className="mt-5">{t("dashboard.connect")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <StatisticsContent
      userId={viewer.id}
      name={viewer.name}
      siteUrl={viewer.siteUrl}
      avatar={viewer.avatar?.large ?? null}
    />
  );
}

function StatisticsContent({
  userId,
  name,
  siteUrl,
  avatar,
}: {
  userId: number;
  name: string;
  siteUrl: string;
  avatar: string | null;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<MediaType>("ANIME");
  const [category, setCategory] = useState<Category>("overview");

  const { data, isLoading, error } = useQuery({
    queryKey: ["userStats", userId],
    queryFn: () => userStatistics(userId),
    enabled: isTauri,
    // AniList only recomputes these when list entries change, and Karasu is
    // what changes them. Revisiting the page inside half an hour is free.
    staleTime: 30 * 60 * 1000,
  });

  // Hoisted out of WatchTimeEstimate. Nested there it only mounted once the
  // stats query had resolved, so a cold /stats waited for the *sum* of the two
  // requests rather than the longer of them. The key is the same one the list
  // page and the SQLite priming use, so this shares their result rather than
  // adding a request.
  const level = useContentFilter((s) => s.level);
  const { data: animeList } = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
    enabled: isTauri,
  });
  const remainingTotal = useMemo(() => {
    let sum = 0;
    for (const group of animeList?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) {
        if (e.status !== "CURRENT" && e.status !== "REPEATING") continue;
        if (isBlocked(e.media, level)) continue;
        const rem = remainingMinutes(e.media, e.progress);
        if (rem) sum += rem;
      }
    }
    return sum;
  }, [animeList, level]);

  // The sunburst is the one panel AniList cannot answer: its statistics are
  // one-dimensional, so "what formats are inside each status" has to be
  // counted from the list itself. Same query key as the list screens, so on
  // anime this is the request already in flight above rather than a new one.
  const { data: typeList } = useQuery({
    queryKey: ["mediaList", type, userId],
    queryFn: () => fetchMediaList(userId, type),
    enabled: isTauri,
  });
  const breakdown = useMemo<Slice[]>(() => {
    const byStatus = new Map<MediaListStatus, Map<string, number>>();
    for (const group of typeList?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) {
        if (isBlocked(e.media, level)) continue;
        const formats = byStatus.get(e.status) ?? new Map<string, number>();
        const key = e.media.format ?? "?";
        formats.set(key, (formats.get(key) ?? 0) + 1);
        byStatus.set(e.status, formats);
      }
    }
    return STATUS_ORDER.filter((st) => byStatus.has(st)).map((st) => {
      const formats = [...byStatus.get(st)!].sort((a, b) => b[1] - a[1]);
      return {
        label: t(`status.${type}.${st}`),
        value: formats.reduce((sum, [, n]) => sum + n, 0),
        children: formats.map(([label, value]) => ({ label, value })),
      };
    });
  }, [typeList, level, t, type]);

  const categories = type === "ANIME" ? ANIME_CATEGORIES : MANGA_CATEGORIES;
  // Keep the selected sub-tab valid when switching media type.
  const activeCategory = categories.includes(category) ? category : "overview";

  const typeOptions: TabOption<MediaType>[] = [
    { value: "ANIME", label: t("nav.list") },
    { value: "MANGA", label: t("nav.manga") },
  ];
  const categoryOptions: TabOption<Category>[] = categories.map((c) => ({
    value: c,
    label: t(`stats.${c}`),
  }));

  const stats = data?.statistics;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8 2xl:max-w-none 3xl:max-w-[130rem]">
      <header className="flex items-center gap-4">
        {/* Avatar without the lockup: the text beside it is this screen's title,
            not the user's name, so there is no name/sub stack to share. */}
        <Avatar src={avatar} size="lg" fallback={<BarChart3 className="size-5" />} />
        <div className="min-w-0 flex-1">
          {/* The same lockup the two list screens use: title, then its
              Japanese form a shade back. */}
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold">{t("stats.title")}</h1>
            <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
              統計
            </span>
          </div>
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-accent-400 hover:underline"
          >
            {name} <ExternalLink className="size-2.75" />
          </a>
        </div>
        <Link to="/wrapped">
          <Button variant="secondary" size="sm">
            <Sparkles className="size-3.5" /> {t("wrapped.title")}
          </Button>
        </Link>
      </header>

      <div className="space-y-3">
        <Tabs options={typeOptions} value={type} onChange={setType} />
        <Tabs
          options={categoryOptions}
          value={activeCategory}
          onChange={setCategory}
        />
      </div>

      {isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {error && (
        <p className="text-danger">
          {t("common.error", { message: String(error) })}
        </p>
      )}
      {stats &&
        (type === "ANIME" ? (
          <AnimeView
            stats={stats.anime}
            category={activeCategory}
            breakdown={breakdown}
          />
        ) : (
          <MangaView
            stats={stats.manga}
            category={activeCategory}
            breakdown={breakdown}
          />
        ))}

      {stats && type === "ANIME" && activeCategory === "overview" && (
        <WatchTimeEstimate total={remainingTotal} />
      )}
    </div>
  );
}

/** "Time to finish your watching list", summed from the cached anime list. */
function WatchTimeEstimate({ total }: { total: number }) {
  const { t } = useTranslation();

  if (total <= 0) return null;
  return (
    <Card>
      <CardTitle>{t("stats.timeToFinish")}</CardTitle>
      <p className="mt-2 text-2xl font-bold tabular-nums">
        {formatMinutes(total, t)}
      </p>
      <p className="text-xs text-ink-600">{t("stats.timeToFinishHint")}</p>
    </Card>
  );
}

function AnimeView({
  stats,
  category,
  breakdown,
}: {
  stats: AnimeStats;
  category: Category;
  breakdown: Slice[];
}) {
  const { t, i18n } = useTranslation();
  const level = useContentFilter((s) => s.level);
  if (stats.count === 0) return <Empty />;

  if (category === "overview") {
    const days = stats.minutesWatched / 60 / 24;
    return (
      <div className="space-y-6">
        <TileGrid
          tiles={[
            { label: t("stats.entries"), value: fmt(stats.count, i18n.language) },
            { label: t("stats.episodes"), value: fmt(stats.episodesWatched, i18n.language) },
            { label: t("stats.daysWatched"), value: days.toFixed(1) },
            { label: t("stats.meanScore"), value: scoreText(stats.meanScore) },
            {
              label: t("stats.spread"),
              value: `± ${stats.standardDeviation.toFixed(1)}`,
            },
            {
              label: t("stats.perEntry"),
              value: t("stats.episodesEach", {
                n: (stats.episodesWatched / Math.max(1, stats.count)).toFixed(1),
              }),
            },
          ]}
        />
        <OverviewCharts stats={stats} type="ANIME" breakdown={breakdown} />
      </div>
    );
  }
  return (
    <RankedList
      entries={rowsFor(stats, category, level)}
      category={category}
      type="ANIME"
    />
  );
}

function MangaView({
  stats,
  category,
  breakdown,
}: {
  stats: MangaStats;
  category: Category;
  breakdown: Slice[];
}) {
  const { t, i18n } = useTranslation();
  const level = useContentFilter((s) => s.level);
  if (stats.count === 0) return <Empty />;

  if (category === "overview") {
    return (
      <div className="space-y-6">
        <TileGrid
          tiles={[
            { label: t("stats.entries"), value: fmt(stats.count, i18n.language) },
            { label: t("stats.chapters"), value: fmt(stats.chaptersRead, i18n.language) },
            { label: t("stats.volumes"), value: fmt(stats.volumesRead, i18n.language) },
            { label: t("stats.meanScore"), value: scoreText(stats.meanScore) },
            {
              label: t("stats.spread"),
              value: `± ${stats.standardDeviation.toFixed(1)}`,
            },
            {
              label: t("stats.perEntry"),
              value: t("stats.chaptersEach", {
                n: (stats.chaptersRead / Math.max(1, stats.count)).toFixed(0),
              }),
            },
          ]}
        />
        <OverviewCharts stats={stats} type="MANGA" breakdown={breakdown} />
      </div>
    );
  }
  return (
    <RankedList
      entries={rowsFor(stats, category, level)}
      category={category}
      type="MANGA"
    />
  );
}

/**
 * Picks the ranked array for a category (empty for categories a type lacks).
 *
 * These statistics are aggregated by AniList, so filtered titles cannot be
 * subtracted from the totals client-side. What we *can* do is stop a filtered
 * genre or tag name from being listed — see the note under the list.
 */
function rowsFor(
  stats: AnimeStats | MangaStats,
  category: Category,
  level: ContentFilterLevel,
): StatEntry[] {
  switch (category) {
    case "genres":
      return stats.genres.filter((e) => !isBlockedGenre(e.genre ?? "", level));
    case "tags":
      return stats.tags.filter(
        (e) => !isBlockedGenre(e.tag?.name ?? "", level),
      );
    case "staff":
      return stats.staff;
    case "voiceActors":
      return "voiceActors" in stats ? stats.voiceActors : [];
    case "studios":
      return "studios" in stats ? stats.studios : [];
    default:
      return [];
  }
}

function OverviewCharts({
  stats,
  type,
  breakdown,
}: {
  stats: AnimeStats | MangaStats;
  type: MediaType;
  breakdown: Slice[];
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const scores = [...stats.scores].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const years = [...stats.releaseYears]
    .sort((a, b) => (a.releaseYear ?? 0) - (b.releaseYear ?? 0))
    .slice(-16);
  const started = [...stats.startYears]
    .filter((d) => d.startYear)
    .sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0))
    .slice(-16);
  // AniList returns the buckets unordered and spells them "1", "17-28",
  // "101+" — sort on the number each one opens with.
  const lengths = [...stats.lengths]
    .filter((d) => d.length)
    .sort((a, b) => parseInt(a.length ?? "0", 10) - parseInt(b.length ?? "0", 10));
  const countries = [...stats.countries].filter((d) => d.country);
  // The ranked lists below filter these names; the radar and the treemap write
  // them out in full, with counts. Filter before slicing, or a blocked name
  // costs one of the six or fourteen slots it was removed from. The fallback
  // has to be the filtered genres too — a list whose `tags` come back empty
  // would otherwise put the unfiltered names straight into the treemap.
  const safeGenres = stats.genres.filter((e) => !isBlockedGenre(e.genre ?? "", level));
  const safeTags = stats.tags.filter((e) => !isBlockedGenre(e.tag?.name ?? "", level));
  const genres = safeGenres.slice(0, 6);
  const tags = (safeTags.length ? safeTags : safeGenres).slice(0, 14);
  // The sunburst's outer ring is the formats inside each status. Totalled
  // across statuses they are the same figures the Formats panel lists, but the
  // ring needs its own key on its own card to be readable at all.
  const formatsInBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const group of breakdown) {
      for (const kid of group.children ?? []) {
        totals.set(kid.label, (totals.get(kid.label) ?? 0) + kid.value);
      }
    }
    return [...totals]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
  }, [breakdown]);
  // Stretched, with every card a flex column that knows what to do with the
  // slack. `items-start` used to be the answer here, on the grounds that a
  // fixed-viewBox chart cannot grow — but that left ragged gaps *between* the
  // panels instead, which is what this row now avoids: the bar panels grow
  // their plot area into the extra height, and the SVG panels centre their
  // chart in it so the leftover reads as padding rather than a hole.
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ScoreColumns
        title={t("stats.scoreDist")}
        hint={t("stats.scoreDistHint")}
        data={scores.map((d: Distribution) => ({
          score: d.score ?? 0,
          count: d.count,
        }))}
      />
      <StatusBar
        title={t("stats.statuses")}
        data={stats.statuses.map((d) => ({
          label: t(`status.${type}.${d.status}`, { defaultValue: d.status ?? "?" }),
          count: d.count,
        }))}
      />
      <YearSparkline
        title={t("stats.releaseYears")}
        data={years.map((d) => ({ year: d.releaseYear ?? 0, count: d.count }))}
      />
      <DistributionCard
        title={t("stats.formats")}
        data={stats.formats.map((d) => ({ label: d.format ?? "?", count: d.count }))}
      />
      {/* Release years say what you watch; start years say when you were
          watching it. A line rather than the bars above, because these are one
          series continuing rather than years to compare against each other. */}
      {started.length > 1 && (
        <Card className="flex h-full flex-col">
          <CardTitle>{t("stats.startYears")}</CardTitle>
          <div className="mt-4 flex flex-1 items-center">
            <LineChart
              data={started.map((d) => ({
                label: String(d.startYear ?? 0),
                value: d.count,
              }))}
            />
          </div>
        </Card>
      )}

      {breakdown.length > 0 && (
        <Card className="flex h-full flex-col">
          <CardTitle>{t("stats.breakdown")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.breakdownHint")}</p>
          {/* Chart beside its key rather than wrapped above it. The ring is
              square, so letting it take the whole card width would make the
              panel as tall as the page is wide. */}
          <div className="mt-3 flex flex-1 items-center gap-6">
            <div className="w-40 shrink-0 sm:w-48">
              <Sunburst data={breakdown} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <ToneLegend
                items={breakdown.map((b) => ({ label: b.label, value: b.value }))}
              />
              {/* The outer ring had no key at all — its formats were readable
                  only by hovering, which is the thing this pass is undoing. */}
              {formatsInBreakdown.length > 0 && (
                <div>
                  <p className="mb-1.5 text-2xs uppercase tracking-[.1em] text-ink-600">
                    {t("stats.outerRing")}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {formatsInBreakdown.map((f) => (
                      <span key={f.label} className="text-2xs text-ink-500">
                        {f.label}
                        <span className="ml-1 tabular-nums text-ink-300">{f.value}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {genres.length > 2 && (
        <Card className="flex h-full flex-col">
          <CardTitle>{t("stats.genreShape")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.genreShapeHint")}</p>
          <div className="mt-2 flex flex-1 items-center justify-center">
            <div className="w-full max-w-72">
              <RadarChart
                axes={genres.map((g) => ({
                  label: g.genre ?? "?",
                  value: g.count,
                }))}
              />
            </div>
          </div>
        </Card>
      )}

      {tags.length > 3 && (
        <Card className="flex h-full flex-col lg:col-span-2">
          <CardTitle>{t("stats.tagMap")}</CardTitle>
          <div className="mt-3 flex flex-1 items-center">
            <Treemap
              data={tags.map((entry) => ({
                label: entry.tag?.name ?? entry.genre ?? "?",
                value: entry.count,
              }))}
            />
          </div>
        </Card>
      )}
      <DistributionCard
        title={t("stats.lengths")}
        data={lengths.map((d) => ({
          label: t(
            type === "ANIME" ? "stats.lengthBucketEp" : "stats.lengthBucketCh",
            { range: d.length },
          ),
          count: d.count,
        }))}
      />
      {countries.length > 1 && (
        <StatusBar
          title={t("stats.countries")}
          data={countries.map((d) => ({
            label: t(`country.${d.country}`, { defaultValue: d.country ?? "?" }),
            count: d.count,
          }))}
        />
      )}
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------
