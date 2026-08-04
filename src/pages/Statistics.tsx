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
import { cn } from "@/lib/utils";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import {
  LineChart,
  RadarChart,
  Sunburst,
  ToneLegend,
  Treemap,
  type Slice,
} from "@/components/charts";
import { STATUS_ORDER, type MediaListStatus } from "@/api/types";

type Category = "overview" | "genres" | "tags" | "voiceActors" | "studios" | "staff";
type SortKey = "count" | "time" | "score";

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
        {avatar ? (
          <img src={avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-800 text-accent-400">
            <BarChart3 className="size-5" />
          </span>
        )}
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
  const genres = stats.genres.slice(0, 6);
  const tags = (stats.tags.length ? stats.tags : stats.genres).slice(0, 14);
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
        <Card>
          <CardTitle>{t("stats.startYears")}</CardTitle>
          <div className="mt-4">
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
        <Card>
          <CardTitle>{t("stats.breakdown")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.breakdownHint")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-5">
            <Sunburst data={breakdown} />
            <div className="min-w-40 flex-1">
              <ToneLegend
                items={breakdown.map((b) => ({ label: b.label, value: b.value }))}
              />
            </div>
          </div>
        </Card>
      )}

      {genres.length > 2 && (
        <Card>
          <CardTitle>{t("stats.genreShape")}</CardTitle>
          <p className="mt-1 text-2xs text-ink-600">{t("stats.genreShapeHint")}</p>
          <div className="mt-2 flex justify-center">
            <RadarChart
              axes={genres.map((g) => ({
                label: g.genre ?? "?",
                value: g.count,
              }))}
            />
          </div>
        </Card>
      )}

      {tags.length > 3 && (
        <Card className="lg:col-span-2">
          <CardTitle>{t("stats.tagMap")}</CardTitle>
          <div className="mt-3">
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

/**
 * Score distribution as ten columns.
 *
 * Vertical rather than the horizontal bars everything else uses, because the
 * axis is the score itself and it runs 1–10 whether or not every step has
 * entries. 8–10 take the accent: the shape of the tail is the interesting
 * part — whether you are a generous scorer — and colour says it faster than
 * reading the counts.
 */
function ScoreColumns({
  title,
  hint,
  data,
}: {
  title: string;
  hint: string;
  data: { score: number; count: number }[];
}) {
  if (data.length === 0) return null;
  const by = new Map(data.map((d) => [d.score, d.count]));
  // AniList lets a user score on 3, 5, 10 or 100 points and the payload only
  // carries the buckets in use, so the axis is inferred from the highest one:
  // a five-point list must not be drawn as half of a ten-column chart, and a
  // hundred-point list must not be drawn as a hundred columns.
  const top = Math.max(...data.map((d) => d.score), 0);
  const scale = top <= 3 ? 3 : top <= 5 ? 5 : top <= 10 ? 10 : 0;
  const steps = scale
    ? Array.from({ length: scale }, (_, i) => i + 1)
    : data.map((d) => d.score);
  const max = Math.max(...data.map((d) => d.count), 1);
  const high = Math.max(...steps) * 0.75;

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <p className="mt-1 text-2xs text-ink-600">{hint}</p>
      <div className="mt-4 flex items-end gap-1.75">
        {steps.map((step) => {
          const count = by.get(step) ?? 0;
          return (
            <div key={step} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-2xs tabular-nums text-ink-600">
                {count || ""}
              </span>
              <div className="flex h-32 w-full items-end">
                <div
                  className={cn(
                    "w-full rounded-t-[.1875rem]",
                    step >= high ? "bg-accent-500" : "bg-surface-700",
                  )}
                  // A count of zero still draws a hairline, so the gap reads as
                  // "none at this score" rather than as a missing column.
                  style={{ height: `${Math.max((count / max) * 100, 1)}%` }}
                />
              </div>
              <span className="text-2xs tabular-nums text-ink-500">{step}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Statuses as one stacked bar plus a legend.
 *
 * Five separate bars answer "how many are paused"; one stacked bar answers
 * "what does my list look like", which is the question this panel is on the
 * page for.
 */
function StatusBar({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
  // Shades of the surface ramp with the accent leading, so the segments read
  // as one bar divided rather than five colours competing.
  const tone = [
    "var(--color-accent-500)",
    "var(--color-accent-400)",
    "var(--color-surface-600)",
    "var(--color-surface-700)",
    "var(--color-surface-800)",
    "var(--color-graph-none)",
  ];

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-800">
        {data.map((d, i) => (
          <span
            key={d.label}
            title={`${d.label}: ${d.count}`}
            style={{
              width: `${(d.count / total) * 100}%`,
              background: tone[i % tone.length],
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-[.125rem]"
              style={{ background: tone[i % tone.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-500">{d.label}</span>
            <span className="shrink-0 tabular-nums text-ink-300">{d.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Release years as a sparkline with only its ends labelled.
 *
 * Sixteen labelled rows is a table nobody reads; the shape is the point, and
 * the two end labels are all that is needed to place it in time. The last
 * three years take the accent — that is the part of the chart that is still
 * moving.
 */
function YearSparkline({
  title,
  data,
}: {
  title: string;
  data: { year: number; count: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const recent = data.length - 3;

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="mt-4 flex h-20 items-end gap-0.75">
        {data.map((d, i) => (
          <div
            key={d.year}
            title={`${d.year}: ${d.count}`}
            className={cn(
              "flex-1 rounded-t-[.125rem]",
              i >= recent ? "bg-accent-500" : "bg-surface-700",
            )}
            style={{ height: `${Math.max((d.count / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-2xs tabular-nums text-ink-600">
        <span>{data[0].year}</span>
        <span>{data[data.length - 1].year}</span>
      </div>
    </Card>
  );
}

function TileGrid({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-surface-800 bg-surface-900 px-4 py-3"
        >
          <p className="text-xl font-bold tabular-nums">{tile.value}</p>
          <p className="text-xs text-ink-600">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

function DistributionCard({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="mt-3 space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate text-ink-500">{d.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-surface-800">
              <div
                className="h-full rounded bg-accent-500"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-ink-500">
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const TOP_N = 25;

function RankedList({
  entries,
  category,
  type,
}: {
  entries: StatEntry[];
  category: Category;
  type: MediaType;
}) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<SortKey>("count");
  const [expanded, setExpanded] = useState(false);

  const metric = (e: StatEntry) =>
    type === "ANIME" ? e.minutesWatched : e.chaptersRead;

  const sorted = useMemo(() => {
    const value = (e: StatEntry) =>
      sort === "count" ? e.count : sort === "score" ? e.meanScore : metric(e);
    return [...entries].sort((a, b) => value(b) - value(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sort, type]);

  if (entries.length === 0) return <Empty />;

  const shown = expanded ? sorted : sorted.slice(0, TOP_N);
  const barValue = (e: StatEntry) =>
    sort === "score" ? e.meanScore : sort === "time" ? metric(e) : e.count;
  const max = Math.max(...shown.map(barValue), 1);

  const timeLabel = type === "ANIME" ? t("stats.sortByTime") : t("stats.sortByChapters");
  const sortOptions: TabOption<SortKey>[] = [
    { value: "count", label: t("stats.sortByCount") },
    { value: "time", label: timeLabel },
    { value: "score", label: t("stats.sortByScore") },
  ];

  return (
    <div className="space-y-3">
      <Tabs options={sortOptions} value={sort} onChange={setSort} />
      {/* Self-contained rows, so a wide screen shows two or three at a time
          instead of one very long bar per line. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] gap-1.5">
        {shown.map((e, i) => (
          <RankedRow
            key={entryKey(e, category)}
            rank={i + 1}
            entry={e}
            category={category}
            type={type}
            barPct={(barValue(e) / max) * 100}
            metricText={
              type === "ANIME"
                ? t("stats.hours", { n: fmt(Math.round(e.minutesWatched / 60), i18n.language) })
                : t("stats.chaptersShort", { n: fmt(e.chaptersRead, i18n.language) })
            }
          />
        ))}
      </div>
      {sorted.length > TOP_N && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-accent-400 hover:underline"
        >
          {expanded ? t("stats.showLess") : t("stats.showAll", { n: sorted.length })}
        </button>
      )}
    </div>
  );
}

function RankedRow({
  rank,
  entry,
  category,
  barPct,
  metricText,
}: {
  rank: number;
  entry: StatEntry;
  category: Category;
  type: MediaType;
  barPct: number;
  metricText: string;
}) {
  const image = entryImage(entry, category);
  const label = entryLabel(entry, category);
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-900">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-600">
        {rank}
      </span>
      {image !== undefined &&
        (image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="h-8 w-8 shrink-0 rounded-full bg-surface-800" />
        ))}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-ink-100">{label}</span>
          <span className="shrink-0 text-xs tabular-nums text-ink-500">
            {entry.count}× · {metricText}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded bg-surface-800">
          <div
            className="h-full rounded bg-accent-500"
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-gold">
        {scoreText(entry.meanScore)}
      </span>
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-600">{t("stats.empty")}</p>;
}

// --- Helpers ---------------------------------------------------------------

/** Whether a category shows an avatar column (people do, genres/tags/studios don't). */
function entryImage(e: StatEntry, category: Category): string | null | undefined {
  if (category === "voiceActors") return e.voiceActor?.image?.medium ?? null;
  if (category === "staff") return e.staff?.image?.medium ?? null;
  return undefined; // no avatar column
}

function entryLabel(e: StatEntry, category: Category): string {
  switch (category) {
    case "genres":
      return e.genre ?? "?";
    case "tags":
      return e.tag?.name ?? "?";
    case "voiceActors":
      return e.voiceActor?.name.full ?? "?";
    case "studios":
      return e.studio?.name ?? "?";
    case "staff":
      return e.staff?.name.full ?? "?";
    default:
      return "?";
  }
}

function entryKey(e: StatEntry, category: Category): string {
  switch (category) {
    case "genres":
      return `g-${e.genre}`;
    case "tags":
      return `t-${e.tag?.id}`;
    case "voiceActors":
      return `va-${e.voiceActor?.id}`;
    case "studios":
      return `s-${e.studio?.id}`;
    case "staff":
      return `st-${e.staff?.id}`;
    default:
      return Math.random().toString();
  }
}

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

/** AniList mean scores are on a 0–100 scale; show them rounded. */
/**
 * Scores read to one decimal, never rounded to a whole number.
 *
 * `userStatistics` hands these over already divided by ten, so rounding here
 * would throw away the digit that division just made meaningful — a 7.1 and a
 * 7.4 are the difference between two shelves of a list.
 */
function scoreText(score: number): string {
  return score > 0 ? score.toFixed(1) : "–";
}
