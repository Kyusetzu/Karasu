import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { airingWeek, type AiringSlot } from "@/api/queries";
import { fetchMediaList, isTauri } from "@/api/anilist";
import type { Media, MediaListEntry } from "@/api/types";
import {
  addDays,
  bucketByLocalDay,
  fromList,
  weekDays,
  weekStartOf,
} from "@/lib/calendar";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { DigestRow } from "@/components/media/DigestRow";
import { SectionHeader } from "@/components/ui/section-header";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

/**
 * The airing calendar: a week of episodes, Monday-first, today highlighted.
 *
 * Two lenses, and they cost very different things:
 *
 * - **My shows** (default) is free — it projects the cached list's
 *   `nextAiringEpisode` into the week, so it opens instantly and works
 *   offline. One episode per show is that source's honest limit.
 * - **Everything** is the real schedule: `Page.airingSchedules` for the whole
 *   window, a *bounded* sequential fetch (measured ~120 airings ≈ 3 pages,
 *   capped at 5) behind the one user action of opening or paging the week,
 *   cached for 30 minutes. List membership is still marked from the cache —
 *   `mediaListEntry` per schedule row would widen the payload to answer a
 *   question the list already answers.
 *
 * Week and lens live in the URL, so Back restores the view and a week is a
 * link someone can keep. Anime only, and honestly so: AniList exposes no
 * chapter-release schedule for manga.
 */

type Lens = "mine" | "all";

/** One rendered row, whichever lens produced it. */
interface Slot {
  key: string;
  airingAt: number;
  episode: number;
  media: Pick<Media, "id" | "title" | "coverImage">;
  entry: MediaListEntry | null;
}

export default function Calendar() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const viewer = useAuth((s) => s.viewer);
  const userId = viewer?.id ?? 0;
  const level = useContentFilter((s) => s.level);

  const lens: Lens = params.get("lens") === "all" ? "all" : "mine";
  const currentWeek = weekStartOf(Date.now());
  const rawWeek = Number(params.get("week"));
  // A week param must be a real week start — anything else (including a
  // hand-edited value) snaps to the week it falls in.
  const week = Number.isFinite(rawWeek) && rawWeek > 0 ? weekStartOf(rawWeek * 1000) : currentWeek;
  const weekEnd = addDays(week, 7);
  const days = weekDays(week);

  const setView = (patch: { lens?: Lens; week?: number }) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (patch.lens !== undefined) {
          if (patch.lens === "mine") p.delete("lens");
          else p.set("lens", patch.lens);
        }
        if (patch.week !== undefined) {
          if (patch.week === currentWeek) p.delete("week");
          else p.set("week", String(patch.week));
        }
        return p;
      },
      { replace: true },
    );
  };

  // The cached list serves both lenses: it *is* the "My shows" data, and it
  // marks membership on the "Everything" one. Same key the list page and the
  // Dashboard use, so this is almost always a cache hit.
  const list = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
    enabled: isTauri,
  });

  const entries = useMemo(
    () =>
      list.data?.lists
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => !isBlocked(e.media, level)) ?? [],
    [list.data, level],
  );

  const onList = useMemo(
    () => new Map(entries.map((e) => [e.mediaId, e])),
    [entries],
  );

  // Everything: fetched only while that lens is active — an unmounted query
  // has no observer, and the mine lens must stay a zero-request screen. Not
  // keyed on the filter level: blocking is client-side, and a filter change
  // must not spend the budget again.
  const all = useQuery({
    queryKey: ["calendar", week],
    queryFn: () => airingWeek(week, weekEnd),
    enabled: isTauri && lens === "all",
    staleTime: 30 * 60 * 1000,
  });

  const slots: Slot[] = useMemo(() => {
    if (lens === "mine") {
      return fromList(entries, week, weekEnd, ["CURRENT", "REPEATING", "PLANNING"]).map(
        (x) => ({
          key: `l${x.entry.id}`,
          airingAt: x.airingAt,
          episode: x.episode,
          media: x.entry.media,
          entry: x.entry,
        }),
      );
    }
    return (all.data ?? [])
      .filter((s: AiringSlot) => !isBlocked(s.media as Media, level))
      .map((s) => ({
        key: `a${s.id}`,
        airingAt: s.airingAt,
        episode: s.episode,
        media: s.media,
        entry: onList.get(s.media.id) ?? null,
      }));
  }, [lens, entries, all.data, level, onList, week, weekEnd]);

  const buckets = useMemo(() => bucketByLocalDay(slots, days), [slots, days]);
  const todayMidnight = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  })();

  const weekLabel = `${new Date(week * 1000).toLocaleDateString(i18n.language, {
    day: "numeric",
    month: "short",
  })} – ${new Date(addDays(week, 6) * 1000).toLocaleDateString(i18n.language, {
    day: "numeric",
    month: "short",
  })}`;

  const loading = lens === "all" ? all.isLoading : list.isLoading;
  const error = lens === "all" ? all.error : list.error;

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-2xl font-bold">{t("calendar.title")}</h1>
            <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
              放送カレンダー
            </span>
          </div>
          <span className="section-rule" />
          <span className="text-sm tabular-nums text-ink-500">{weekLabel}</span>
          <Button
            variant="ghost"
            size="iconControl"
            onClick={() => setView({ week: addDays(week, -7) })}
            aria-label={t("calendar.prevWeek")}
          >
            <ChevronLeft className="size-4.5" />
          </Button>
          {week !== currentWeek && (
            <Button variant="ghost" size="sm" onClick={() => setView({ week: currentWeek })}>
              {t("calendar.thisWeek")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="iconControl"
            onClick={() => setView({ week: addDays(week, 7) })}
            aria-label={t("calendar.nextWeek")}
          >
            <ChevronRight className="size-4.5" />
          </Button>
        </div>

        <Segmented
          className="mt-3"
          aria-label={t("calendar.lens")}
          value={lens}
          onChange={(v) => setView({ lens: v as Lens })}
          segments={[
            { value: "mine", label: t("calendar.lensMine") },
            { value: "all", label: t("calendar.lensAll") },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error ? (
          <p className="text-sm text-danger">{t("common.error", { message: String(error) })}</p>
        ) : loading ? (
          <div className="space-y-3" aria-hidden="true">
            <Shimmer className="h-5 w-40 rounded" />
            <Shimmer className="h-12 w-full rounded-xl" index={1} />
            <Shimmer className="h-12 w-4/5 rounded-xl" index={2} />
            <Shimmer className="mt-6 h-5 w-40 rounded" index={3} />
            <Shimmer className="h-12 w-full rounded-xl" index={4} />
          </div>
        ) : slots.length === 0 ? (
          <EmptyState
            visual={<TickMarks />}
            title={t(lens === "mine" ? "calendar.emptyMine" : "calendar.emptyAll")}
            hint={lens === "mine" ? t("calendar.emptyMineHint") : undefined}
          />
        ) : (
          <div className="space-y-7">
            {days.map((day, i) =>
              buckets[i].length === 0 ? null : (
                <DaySection
                  key={day}
                  day={day}
                  isToday={day === todayMidnight}
                  slots={buckets[i]}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DaySection({
  day,
  isToday,
  slots,
}: {
  day: number;
  isToday: boolean;
  slots: Slot[];
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(day * 1000);

  return (
    <section className={cn(isToday && "rounded-xl bg-surface-900/50 p-3 -mx-3")}>
      <SectionHeader
        icon={Clock}
        title={date.toLocaleDateString(i18n.language, { weekday: "long" })}
        meta={
          date.toLocaleDateString(i18n.language, { day: "2-digit", month: "2-digit" }) +
          (isToday ? ` · ${t("calendar.today")}` : "")
        }
      />
      <div className="mt-2 grid gap-0.5 2xl:grid-cols-2">
        {slots.map((s) => (
          <DigestRow
            key={s.key}
            media={s.media}
            note={
              t("common.episode", { n: s.episode }) +
              (s.entry && s.entry.progress < s.episode - 1
                ? ` · ${t("dashboard.youAreAt", { n: s.entry.progress })}`
                : "")
            }
            when={new Date(s.airingAt * 1000).toLocaleTimeString(i18n.language, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            marker={
              s.entry ? (
                <span
                  title={t(`status.ANIME.${s.entry.status}`)}
                  className="ml-1 grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success"
                >
                  <Check className="size-3" />
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
