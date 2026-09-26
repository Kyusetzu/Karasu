import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { type StatEntry } from "@/api/queries";
import type { MediaType } from "@/api/types";
import { Segmented, type Segment } from "@/components/ui/segmented";
import { Empty, type RankedCategory, type SortKey } from "./shared";

/** AniList clamps `userStatistics` category lists server-side whatever `limit` says, so this is all of it, not a choice. */
export const TOP_N = 30;

export function RankedList({
  entries,
  category,
  type,
}: {
  entries: StatEntry[];
  category: RankedCategory;
  type: MediaType;
}) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<SortKey>("count");

  const metric = (e: StatEntry) =>
    type === "ANIME" ? e.minutesWatched : e.chaptersRead;

  const sorted = useMemo(() => {
    const value = (e: StatEntry) =>
      sort === "count" ? e.count : sort === "score" ? e.meanScore : metric(e);
    return [...entries].sort((a, b) => value(b) - value(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sort, type]);

  if (entries.length === 0) return <Empty />;

  const shown = sorted.slice(0, TOP_N);
  const barValue = (e: StatEntry) =>
    sort === "score" ? e.meanScore : sort === "time" ? metric(e) : e.count;
  const max = Math.max(...shown.map(barValue), 1);

  const timeLabel = type === "ANIME" ? t("stats.sortByTime") : t("stats.sortByChapters");
  const sortOptions: Segment<SortKey>[] = [
    { value: "count", label: t("stats.sortByCount") },
    { value: "time", label: timeLabel },
    { value: "score", label: t("stats.sortByScore") },
  ];

  return (
    <div className="space-y-3">
      <Segmented aria-label={t("stats.sortLabel")} segments={sortOptions} value={sort} onChange={setSort} />
      {/* Self-contained rows, so a wide screen shows several per line instead of one very long bar. */}
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
    </div>
  );
}

export function RankedRow({
  rank,
  entry,
  category,
  barPct,
  metricText,
}: {
  rank: number;
  entry: StatEntry;
  category: RankedCategory;
  type: MediaType;
  barPct: number;
  metricText: string;
}) {
  const image = entryImage(entry, category);
  const label = entryLabel(entry, category);
  const href = entryHref(entry, category);
  // Only the wrapping element changes, so a non-navigable category keeps exactly the layout it had.
  const row = (
    <div className="flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-900">
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
        <div className="mt-1 h-2 overflow-hidden rounded-inner bg-surface-800">
          <div
            className="h-full rounded-inner bg-accent-500"
            style={{ width: `${barPct}%` }}
          />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-gold">
        {scoreText(entry.meanScore)}
      </span>
    </div>
  );
  return href ? (
    <Link to={href} className="block">
      {row}
    </Link>
  ) : (
    row
  );
}

/** Whether a category shows an avatar column (people do, genres/tags/studios don't). */
export function entryImage(e: StatEntry, category: RankedCategory): string | null | undefined {
  if (category === "voiceActors") return e.voiceActor?.image?.medium ?? null;
  if (category === "staff") return e.staff?.image?.medium ?? null;
  return undefined; // no avatar column
}

/** Where a row leads, or null for genres and tags, which have no page behind them rather than an invented search link. */
export function entryHref(e: StatEntry, category: RankedCategory): string | null {
  if (category === "voiceActors" && e.voiceActor?.id) return `/staff/${e.voiceActor.id}`;
  if (category === "staff" && e.staff?.id) return `/staff/${e.staff.id}`;
  if (category === "studios" && e.studio?.id) return `/studio/${e.studio.id}`;
  return null;
}

export function entryLabel(e: StatEntry, category: RankedCategory): string {
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

export function entryKey(e: StatEntry, category: RankedCategory): string {
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

export function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

/** Scores read to one decimal, never whole: `userStatistics` already divided by ten, and rounding drops that digit. */
export function scoreText(score: number): string {
  return score > 0 ? score.toFixed(1) : "–";
}
