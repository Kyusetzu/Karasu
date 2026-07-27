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
import { Tabs, type TabOption } from "@/components/ui/tabs";

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
          <h1 className="text-xl font-bold">{t("stats.title")}</h1>
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
        <p className="text-red-300">
          {t("common.error", { message: String(error) })}
        </p>
      )}
      {stats &&
        (type === "ANIME" ? (
          <AnimeView stats={stats.anime} category={activeCategory} />
        ) : (
          <MangaView stats={stats.manga} category={activeCategory} />
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
}: {
  stats: AnimeStats;
  category: Category;
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
          ]}
        />
        <OverviewCharts stats={stats} type="ANIME" />
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
}: {
  stats: MangaStats;
  category: Category;
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
          ]}
        />
        <OverviewCharts stats={stats} type="MANGA" />
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
}: {
  stats: AnimeStats | MangaStats;
  type: MediaType;
}) {
  const { t } = useTranslation();
  const scores = [...stats.scores].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const years = [...stats.releaseYears]
    .sort((a, b) => (a.releaseYear ?? 0) - (b.releaseYear ?? 0))
    .slice(-16);
  return (
    <div className="grid gap-4 sm:grid-cols-2 3xl:grid-cols-4">
      <DistributionCard
        title={t("stats.formats")}
        data={stats.formats.map((d) => ({ label: d.format ?? "?", count: d.count }))}
      />
      <DistributionCard
        title={t("stats.statuses")}
        data={stats.statuses.map((d) => ({
          label: t(`status.${type}.${d.status}`, { defaultValue: d.status ?? "?" }),
          count: d.count,
        }))}
      />
      <DistributionCard
        title={t("stats.scoreDist")}
        data={scores.map((d: Distribution) => ({
          label: String(d.score ?? 0),
          count: d.count,
        }))}
      />
      <DistributionCard
        title={t("stats.releaseYears")}
        data={years.map((d) => ({ label: String(d.releaseYear ?? 0), count: d.count }))}
      />
    </div>
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
            <span className="w-8 shrink-0 text-right tabular-nums text-ink-400">
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
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-amber-300">
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
function scoreText(score: number): string {
  return score > 0 ? String(Math.round(score)) : "–";
}
