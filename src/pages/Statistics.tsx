import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
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
import { useAuth, useScoreFormat } from "@/stores/auth";
import { scoreScale } from "@/lib/scoreFormat";
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
  RadarChart,
  Sunburst,
  ToneLegend,
  Treemap,
  type Slice,
} from "@/components/stats/Charts";
import { STATUS_ORDER, type MediaListStatus } from "@/api/types";
import { SectionHeader } from "@/components/ui/section-header";
import { Empty, type Category, type RankedCategory } from "@/components/stats/shared";
import { DistributionCard, ScoreColumns, StatusBar, TileGrid } from "@/components/stats/panels";
import { GradientBars } from "@/components/stats/GradientBars";
import { DotPlot } from "@/components/stats/DotPlot";
import { AreaChart } from "@/components/stats/AreaChart";
import { Heatmap } from "@/components/stats/Heatmap";
import {
  activityHeatmap,
  scoreDelta,
  seasonalHistory,
  type ActivityHeatmap,
  type ScoreDeltaSummary,
  type SeasonCount,
} from "@/lib/localStats";
import { RankedList, fmt, scoreText } from "@/components/stats/RankedList";
/**
 * Five themed tabs rather than one per ranked array. The old shape — a tab
 * each for genres, tags, voice actors, studios and staff — made eight stops
 * of one list apiece; the five ranked lists now live inside two themed tabs,
 * and both media types share one tab bar (the people tab simply holds fewer
 * sections on manga).
 */
const CATEGORIES: Category[] = ["overview", "ratings", "years", "genresTags", "people"];

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
  // Type and tab in the URL, not in state — Statistics was the last tabbed
  // screen on `useState`, so Back from anywhere lost the selection. Same
  // validate-or-default, delete-at-default, `replace: true` shape as the list
  // view and the profile.
  const [params, setParams] = useSearchParams();
  const type: MediaType = params.get("type") === "MANGA" ? "MANGA" : "ANIME";
  const rawTab = params.get("tab");
  const category: Category = CATEGORIES.includes(rawTab as Category)
    ? (rawTab as Category)
    : "overview";
  const setView = (patch: { type?: MediaType; category?: Category }) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (patch.type !== undefined) {
          if (patch.type === "ANIME") p.delete("type");
          else p.set("type", patch.type);
        }
        if (patch.category !== undefined) {
          if (patch.category === "overview") p.delete("tab");
          else p.set("tab", patch.category);
        }
        return p;
      },
      { replace: true },
    );

  const scoreFormat = useScoreFormat();
  const { data, isLoading, error } = useQuery({
    // The format is part of the key: a format change rescales every number
    // the normalizer produced, so the cached shape is simply for another
    // scale and must not be served.
    queryKey: ["userStats", userId, scoreFormat],
    queryFn: () => userStatistics(userId, scoreFormat),
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
  // The list already in the cache, once, for every local panel below —
  // filtered here so no panel can forget the check. Zero requests.
  const localEntries = useMemo(
    () =>
      (typeList?.lists ?? [])
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => !isBlocked(e.media, level)),
    [typeList, level],
  );
  // "My score against the crowd's" — the one figure AniList's statistics
  // cannot answer.
  const delta = useMemo(
    () => scoreDelta(localEntries, 5, scoreScale(scoreFormat).max),
    [localEntries, scoreFormat],
  );
  // When the list was worked on, from the fuzzy start/completion dates.
  const heatmap = useMemo(() => activityHeatmap(localEntries), [localEntries]);
  const seasons = useMemo(() => seasonalHistory(localEntries), [localEntries]);

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

  // One tab bar for both media types now, so switching type keeps the tab.
  const activeCategory = category;

  const typeOptions: TabOption<MediaType>[] = [
    { value: "ANIME", label: t("nav.list") },
    { value: "MANGA", label: t("nav.manga") },
  ];
  const categoryOptions: TabOption<Category>[] = CATEGORIES.map((c) => ({
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
        <Tabs options={typeOptions} value={type} onChange={(v) => setView({ type: v })} />
        <Tabs
          options={categoryOptions}
          value={activeCategory}
          onChange={(v) => setView({ category: v })}
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
            delta={delta}
            heatmap={heatmap}
            seasons={seasons}
          />
        ) : (
          <MangaView
            stats={stats.manga}
            category={activeCategory}
            breakdown={breakdown}
            delta={delta}
            heatmap={heatmap}
            seasons={seasons}
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
  delta,
  heatmap,
  seasons,
}: {
  stats: AnimeStats;
  category: Category;
  breakdown: Slice[];
  delta: ScoreDeltaSummary | null;
  heatmap: ActivityHeatmap | null;
  seasons: SeasonCount[];
}) {
  const { t, i18n } = useTranslation();
  if (stats.count === 0) return <Empty />;

  if (category === "ratings") {
    return <RatingsView stats={stats} type="ANIME" delta={delta} />;
  }

  if (category === "years") {
    return <YearsView stats={stats} heatmap={heatmap} seasons={seasons} />;
  }

  if (category === "genresTags") {
    return <GenresTagsView stats={stats} type="ANIME" />;
  }

  if (category === "people") {
    return <PeopleView stats={stats} type="ANIME" />;
  }

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

function MangaView({
  stats,
  category,
  breakdown,
  delta,
  heatmap,
  seasons,
}: {
  stats: MangaStats;
  category: Category;
  breakdown: Slice[];
  delta: ScoreDeltaSummary | null;
  heatmap: ActivityHeatmap | null;
  seasons: SeasonCount[];
}) {
  const { t, i18n } = useTranslation();
  if (stats.count === 0) return <Empty />;

  if (category === "ratings") {
    return <RatingsView stats={stats} type="MANGA" delta={delta} />;
  }

  if (category === "years") {
    return <YearsView stats={stats} heatmap={heatmap} seasons={seasons} />;
  }

  if (category === "genresTags") {
    return <GenresTagsView stats={stats} type="MANGA" />;
  }

  if (category === "people") {
    return <PeopleView stats={stats} type="MANGA" />;
  }

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

/**
 * Picks the ranked array for a category (empty for categories a type lacks).
 *
 * These statistics are aggregated by AniList, so filtered titles cannot be
 * subtracted from the totals client-side. What we *can* do is stop a filtered
 * genre or tag name from being listed — see the note under the list.
 */
function rowsFor(
  stats: AnimeStats | MangaStats,
  category: RankedCategory,
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
  }
}

/**
 * The Genres & Tags tab: the shape (radar), the long tail (treemap), the taste
 * check (each genre's mean against your overall mean), and the two ranked
 * lists — everything the list contains, one tab.
 */
function GenresTagsView({
  stats,
  type,
}: {
  stats: AnimeStats | MangaStats;
  type: MediaType;
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const scoreMax = scoreScale(useScoreFormat()).max;

  // Filter before slicing, or a blocked name costs one of the slots it was
  // removed from; the treemap falls back to genres when tags are empty.
  const safeGenres = rowsFor(stats, "genres", level);
  const safeTags = rowsFor(stats, "tags", level);
  const radarGenres = safeGenres.slice(0, 6);
  const treemapTags = (safeTags.length ? safeTags : safeGenres).slice(0, 14);
  // Genres against your own average — deviation from yourself, not from the
  // crowd; the community version lives on the Ratings tab.
  const genreDots = [...safeGenres]
    .filter((g) => g.meanScore > 0)
    .sort((a, b) => Math.abs(b.meanScore - stats.meanScore) - Math.abs(a.meanScore - stats.meanScore))
    .slice(0, 8)
    .map((g) => ({ label: g.genre ?? "?", mine: g.meanScore, other: stats.meanScore }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {radarGenres.length > 2 && (
          <Card className="flex h-full flex-col">
            <CardTitle>{t("stats.genreShape")}</CardTitle>
            <p className="mt-1 text-2xs text-ink-600">{t("stats.genreShapeHint")}</p>
            <div className="mt-2 flex flex-1 items-center justify-center">
              <div className="w-full max-w-72">
                <RadarChart
                  axes={radarGenres.map((g) => ({ label: g.genre ?? "?", value: g.count }))}
                />
              </div>
            </div>
          </Card>
        )}
        {genreDots.length > 1 && (
          <DotPlot
            title={t("stats.genreTaste")}
            hint={t("stats.genreTasteHint")}
            legendMine={t("stats.legendGenreMean")}
            legendOther={t("stats.legendOverallMean")}
            rows={genreDots}
            max={scoreMax}
          />
        )}
        {treemapTags.length > 3 && (
          <Card className="flex h-full flex-col lg:col-span-2">
            <CardTitle>{t("stats.tagMap")}</CardTitle>
            <div className="mt-3 flex flex-1 items-center">
              <Treemap
                data={treemapTags.map((entry) => ({
                  label: entry.tag?.name ?? entry.genre ?? "?",
                  value: entry.count,
                }))}
              />
            </div>
          </Card>
        )}
      </div>

      <section className="space-y-3">
        <SectionHeader icon={BarChart3} title={t("stats.genres")} />
        <RankedList entries={safeGenres} category="genres" type={type} />
      </section>
      {safeTags.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={BarChart3} title={t("stats.tags")} />
          <RankedList entries={safeTags} category="tags" type={type} />
        </section>
      )}
    </div>
  );
}

/**
 * The People & Studios tab: the three portrait lists on anime, staff alone on
 * manga — who made what the list holds.
 */
function PeopleView({
  stats,
  type,
}: {
  stats: AnimeStats | MangaStats;
  type: MediaType;
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);

  const sections: { key: RankedCategory; title: string }[] = [
    ...("voiceActors" in stats ? [{ key: "voiceActors" as const, title: t("stats.voiceActors") }] : []),
    { key: "staff", title: t("stats.staff") },
    ...("studios" in stats ? [{ key: "studios" as const, title: t("stats.studios") }] : []),
  ];

  return (
    <div className="space-y-6">
      {sections.map(({ key, title }) => {
        const rows = rowsFor(stats, key, level);
        return rows.length > 0 ? (
          <section key={key} className="space-y-3">
            <SectionHeader icon={BarChart3} title={title} />
            <RankedList entries={rows} category={key} type={type} />
          </section>
        ) : null;
      })}
    </div>
  );
}

/**
 * The Ratings tab: how the scores sit — the distribution, the means AniList
 * computes per format and status (fetched for the first time here; they were
 * always on the endpoint), and the community comparison only the local cache
 * can draw.
 */
function RatingsView({
  stats,
  type,
  delta,
}: {
  stats: AnimeStats | MangaStats;
  type: MediaType;
  delta: ScoreDeltaSummary | null;
}) {
  const { t, i18n } = useTranslation();
  const scoreMax = scoreScale(useScoreFormat()).max;
  const scores = [...stats.scores].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const meanRows = (list: Distribution[], label: (d: Distribution) => string) =>
    list
      .filter((d) => (d.meanScore ?? 0) > 0)
      .sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0))
      .map((d) => ({
        label: label(d),
        value: d.meanScore ?? 0,
        text: (d.meanScore ?? 0).toFixed(1),
        sub: `${fmt(d.count, i18n.language)}×`,
      }));

  return (
    <div className="space-y-6">
      {delta && (
        <TileGrid
          tiles={[
            { label: t("stats.yourMean"), value: delta.meanMine.toFixed(2) },
            { label: t("stats.communityMean"), value: delta.meanCommunity.toFixed(2) },
            {
              label: t("stats.meanDelta"),
              value: `${delta.meanDelta > 0 ? "+" : ""}${delta.meanDelta.toFixed(2)}`,
            },
            { label: t("stats.scoredTitles"), value: fmt(delta.count, i18n.language) },
          ]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ScoreColumns
          title={t("stats.scoreDist")}
          hint={t("stats.scoreDistHint")}
          data={scores.map((d: Distribution) => ({ score: d.score ?? 0, count: d.count }))}
        />
        {/* Pinned to the full scale, or a 7.1 next to a 7.4 reads as a
            landslide. */}
        <GradientBars
          title={t("stats.meanByFormat")}
          hint={t("stats.meanByFormatHint")}
          domain={scoreMax}
          rows={meanRows(stats.formats, (d) => d.format ?? "?")}
        />
        <GradientBars
          title={t("stats.meanByStatus")}
          hint={t("stats.meanByStatusHint")}
          domain={scoreMax}
          rows={meanRows(stats.statuses, (d) =>
            t(`status.${type}.${d.status}`, { defaultValue: d.status ?? "?" }),
          )}
        />
        {delta && (delta.harshest.length > 0 || delta.kindest.length > 0) && (
          <DotPlot
            title={t("stats.vsCommunity")}
            hint={t("stats.vsCommunityHint")}
            legendMine={t("stats.legendMine")}
            legendOther={t("stats.legendCommunity")}
            rows={[...delta.harshest, ...delta.kindest].map((r) => ({
              label: r.title,
              mine: r.mine,
              other: r.community,
            }))}
            max={scoreMax}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The Years tab: the list along its time axes. Release years say what you
 * watch, start years say when you were watching it, the heatmap says which
 * months you were actually at it — the last one from the local list's fuzzy
 * dates, a figure AniList's endpoint does not have.
 */
function YearsView({
  stats,
  heatmap,
  seasons,
}: {
  stats: AnimeStats | MangaStats;
  heatmap: ActivityHeatmap | null;
  seasons: SeasonCount[];
}) {
  const { t, i18n } = useTranslation();
  const scoreMax = scoreScale(useScoreFormat()).max;

  const released = [...stats.releaseYears]
    .filter((d) => d.releaseYear)
    .sort((a, b) => (a.releaseYear ?? 0) - (b.releaseYear ?? 0))
    .slice(-20);
  const started = [...stats.startYears]
    .filter((d) => d.startYear)
    .sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0))
    .slice(-16);
  const startMeans = started
    .filter((d) => (d.meanScore ?? 0) > 0)
    .slice(-12)
    .map((d) => ({
      label: String(d.startYear ?? 0),
      value: d.meanScore ?? 0,
      text: (d.meanScore ?? 0).toFixed(1),
      sub: `${fmt(d.count, i18n.language)}×`,
    }));
  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Date(2000, m, 1).toLocaleDateString(i18n.language, { month: "narrow" }),
      ),
    [i18n.language],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {released.length > 1 && (
        <Card className="flex h-full flex-col">
          <CardTitle>{t("stats.releaseYears")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.releaseYearsHint")}</p>
          <div className="mt-4 flex flex-1 items-center">
            <AreaChart
              data={released.map((d) => ({
                label: String(d.releaseYear ?? 0),
                value: d.count,
              }))}
            />
          </div>
        </Card>
      )}
      {started.length > 1 && (
        <Card className="flex h-full flex-col">
          <CardTitle>{t("stats.startYears")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.startYearsHint")}</p>
          <div className="mt-4 flex flex-1 items-center">
            <AreaChart
              data={started.map((d) => ({
                label: String(d.startYear ?? 0),
                value: d.count,
              }))}
            />
          </div>
        </Card>
      )}
      {heatmap && (
        <div className="lg:col-span-2">
          <Heatmap
            title={t("stats.activityHeatmap")}
            hint={t("stats.activityHeatmapHint")}
            years={heatmap.years}
            max={heatmap.max}
            monthLabels={monthLabels}
          />
        </div>
      )}
      {startMeans.length > 1 && (
        <GradientBars
          title={t("stats.meanByStartYear")}
          hint={t("stats.meanByStartYearHint")}
          domain={scoreMax}
          rows={startMeans}
        />
      )}
      {seasons.length > 0 && (
        <GradientBars
          title={t("stats.seasonHabits")}
          hint={t("stats.seasonHabitsHint")}
          rows={seasons.map((s) => ({
            label: t(`season.${s.season}`, { defaultValue: s.season }),
            value: s.count,
            text: fmt(s.count, i18n.language),
            sub: s.meanScore > 0 ? `★ ${s.meanScore.toFixed(1)}` : undefined,
          }))}
        />
      )}
    </div>
  );
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
  // AniList returns the buckets unordered and spells them "1", "17-28",
  // "101+" — sort on the number each one opens with.
  const lengths = [...stats.lengths]
    .filter((d) => d.length)
    .sort((a, b) => parseInt(a.length ?? "0", 10) - parseInt(b.length ?? "0", 10));
  const countries = [...stats.countries].filter((d) => d.country);
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
      <StatusBar
        title={t("stats.statuses")}
        data={stats.statuses.map((d) => ({
          label: t(`status.${type}.${d.status}`, { defaultValue: d.status ?? "?" }),
          count: d.count,
        }))}
      />
      <DistributionCard
        title={t("stats.formats")}
        data={stats.formats.map((d) => ({ label: d.format ?? "?", count: d.count }))}
      />
      {/* The year serieses moved to the Years tab, which owns the time axis
          now — two homes for one chart is how they drift apart. */}

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

      {/* The radar and the treemap moved to Genres & Tags — one home per
          chart, same reasoning as the year serieses. */}
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
