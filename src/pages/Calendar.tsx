import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Circle, Download } from "lucide-react";
import { airingWeek, type AiringSlot } from "@/api/queries";
import { fetchMediaList, isTauri, saveText } from "@/api/anilist";
import { buildIcs } from "@/lib/ical";
import { IconButton } from "@/components/ui/icon-button";
import { displayTitle, type Media, type MediaListEntry } from "@/api/types";
import {
  addDays,
  bucketByLocalDay,
  foldQuietDays,
  fromList,
  fromSchedule,
  releaseState,
  weekDays,
  weekStartOf,
  type ReleaseState,
} from "@/lib/calendar";
import {
  effectiveView,
  loadCalendarView,
  saveCalendarView,
  weekFits,
  type CalendarView,
} from "@/lib/calendarView";
import { useElementWidth } from "@/hooks/useElementWidth";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { DigestRow } from "@/components/media/DigestRow";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

/** Two lenses over one week fetch: "all" is the whole schedule, "mine" is it narrowed to the list. */

type Lens = "mine" | "all";

/** One rendered row, whichever lens produced it. */
interface Slot {
  key: string;
  airingAt: number;
  episode: number;
  media: Pick<Media, "id" | "title" | "coverImage">;
  entry: MediaListEntry | null;
}

const MINE_STATUSES = ["CURRENT", "REPEATING", "PLANNING"] as const;

/** What the grid assumes before its first measurement, so a desktop never flashes the agenda. */
const WEEK_ASSUMED = 1280;

/** Unix seconds now, read once per render so every card agrees on what has aired. */
const nowSec = () => Math.floor(Date.now() / 1000);

function stateOf(slot: Slot, now: number): ReleaseState {
  if (!slot.entry) return slot.airingAt > now ? "upcoming" : "watched";
  return releaseState(slot.airingAt, slot.episode, slot.entry.progress, now);
}

/** The airing week grid; week and lens live in the URL, and it is anime only since manga has no schedule. */
export default function Calendar() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const viewer = useAuth((s) => s.viewer);
  const userId = viewer?.id ?? 0;
  const level = useContentFilter((s) => s.level);

  const lens: Lens = params.get("lens") === "all" ? "all" : "mine";
  const currentWeek = weekStartOf(Date.now());
  const rawWeek = Number(params.get("week"));
  // A week param must be a real week start; anything else snaps to the week it falls in.
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

  // The cached list serves both lenses, on the same key as the list page so it is almost always a hit.
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

  // One fetch serves both lenses, not keyed on the filter level, so a lens or filter change costs nothing.
  const all = useQuery({
    queryKey: ["calendar", week],
    queryFn: () => airingWeek(week, weekEnd),
    enabled: isTauri,
    staleTime: 30 * 60 * 1000,
  });

  const slots: Slot[] = useMemo(() => {
    if (lens === "mine") {
      // The list's own next episode draws at once and offline; the schedule adds the rest of the week when it lands.
      const toSlot = (x: { airingAt: number; episode: number; entry: MediaListEntry }): Slot => ({
        key: `l${x.entry.id}-${x.episode}`,
        airingAt: x.airingAt,
        episode: x.episode,
        media: x.entry.media,
        entry: x.entry,
      });
      const scheduled = fromSchedule(all.data ?? [], onList, [...MINE_STATUSES]).map(toSlot);
      const seen = new Set(scheduled.map((x) => x.key));
      const projected = fromList(entries, week, weekEnd, [...MINE_STATUSES]).map(toSlot);
      return [...scheduled, ...projected.filter((x) => !seen.has(x.key))].sort(
        (a, b) => a.airingAt - b.airingAt,
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

  // Under "mine" the projection draws immediately; a failed schedule fetch only costs the aired episodes.
  const loading = lens === "all" ? all.isLoading : list.isLoading;
  const error = lens === "all" ? all.error : list.error;

  const [chosen, setChosen] = useState<CalendarView>(loadCalendarView);
  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const phone = usePhoneShell();
  const measured = width === 0 ? WEEK_ASSUMED : width;
  const view = effectiveView(chosen, measured, phone);
  const chooseView = (v: CalendarView) => {
    setChosen(v);
    saveCalendarView(v);
  };
  const viewSegments = [
    ...(weekFits(measured, phone) ? [{ value: "week" as const, label: t("calendar.viewWeek") }] : []),
    { value: "tiles" as const, label: t("calendar.viewTiles") },
    { value: "agenda" as const, label: t("calendar.viewAgenda") },
  ];
  const now = nowSec();
  const exportIcs = () =>
    saveText(
      buildIcs(
        slots.map((s) => ({
          uid: `karasu-${s.media.id}-ep${s.episode}@karasu`,
          start: s.airingAt,
          durationMin: 25,
          summary: `${displayTitle(s.media.title)} — ${t("calendar.ep", { n: s.episode })}`,
        })),
        // Unix *seconds*, like every timestamp in the file.
        Math.floor(Date.now() / 1000),
      ),
      `karasu-airing-${week}.ics`,
      "iCalendar",
      "ics",
    );

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="text-title font-bold">{t("calendar.title")}</h1>
            {/* Hidden on a phone, whose one row belongs to the title and the export. */}
            <span className="hidden whitespace-nowrap font-brand-jp text-ui tracking-lockup text-ink-600 sm:inline">
              放送カレンダー
            </span>
          </div>
          <span className="section-rule" />
          {/* The export is the slots the grid draws, with stable UIDs so a re-export updates instead of duplicating. */}
          {slots.length > 0 && (
            <IconButton
              variant="ghost"
              size="control"
              onClick={() => void exportIcs()}
              aria-label={t("calendar.exportIcs")}
              title={t("calendar.exportIcs")}
            >
              <Download className="size-4" />
            </IconButton>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented
            aria-label={t("calendar.lens")}
            value={lens}
            onChange={(v) => setView({ lens: v as Lens })}
            segments={[
              { value: "mine", label: t("calendar.lensMine") },
              { value: "all", label: t("calendar.lensAll") },
            ]}
          />
          <Segmented
            aria-label={t("calendar.view")}
            value={view}
            onChange={chooseView}
            segments={viewSegments}
          />
          {/* One bar for the week, the full width on a phone so both arrows are an easy reach for a thumb. */}
          <div className="flex w-full items-center rounded-control border border-hair bg-surface-900 p-0.5 sm:ml-auto sm:w-auto">
            <Button
              variant="ghost"
              size="iconControl"
              onClick={() => setView({ week: addDays(week, -7) })}
              aria-label={t("calendar.prevWeek")}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span aria-live="polite" className="flex-1 whitespace-nowrap px-2 text-center text-sm tabular-nums text-ink-300">
              {weekLabel}
            </span>
            {/* Inside the bar, before the arrow: appearing outside it would slide the arrow under a second press. */}
            {week !== currentWeek && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView({ week: currentWeek })}
                aria-label={t("calendar.thisWeek")}
                title={t("calendar.thisWeek")}
                className="shrink-0 whitespace-nowrap max-sm:px-2"
              >
                {/* A glyph on a narrow phone, where the words would squeeze the week's range out of the bar. */}
                <CalendarCheck aria-hidden className="size-4 sm:hidden" />
                <span className="hidden sm:inline">{t("calendar.thisWeek")}</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="iconControl"
              onClick={() => setView({ week: addDays(week, 7) })}
              aria-label={t("calendar.nextWeek")}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* The week grid draws only where its columns fit; the stable gutter keeps the scrollbar from flipping that. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-8 py-6 [scrollbar-gutter:stable]">
        {error ? (
          <p className="text-sm text-danger">{t("common.error", { message: String(error) })}</p>
        ) : loading ? (
          <div className={cn("gap-2", view === "week" ? "grid grid-cols-7" : "flex flex-col")} aria-hidden="true">
            {days.map((day, i) => (
              <Shimmer key={day} className={cn("rounded-panel", view === "week" ? "h-72" : "h-16")} index={i} />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <EmptyState
            visual={<TickMarks />}
            title={t(lens === "mine" ? "calendar.emptyMine" : "calendar.emptyAll")}
            hint={lens === "mine" ? t("calendar.emptyMineHint") : undefined}
          />
        ) : view === "week" ? (
          <div className="grid grid-cols-7 items-stretch gap-2">
            {days.map((day, i) => (
              <DayColumn
                key={day}
                day={day}
                isToday={day === todayMidnight}
                slots={buckets[i]}
                now={now}
              />
            ))}
          </div>
        ) : (
          // A run of days with nothing airing is one quiet line; the week grid keeps its columns, which are the dates.
          <div className="flex flex-col gap-5">
            {foldQuietDays(days, buckets, todayMidnight).map((run) =>
              run.quiet ? (
                <QuietDays key={run.days[0]} days={run.days} />
              ) : (
                <DaySection
                  key={run.days[0]}
                  day={run.days[0]}
                  isToday={run.days[0] === todayMidnight}
                  slots={run.items}
                  now={now}
                  tiles={view === "tiles"}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Adjacent days with nothing airing, as one muted line naming the first and last of them. */
function QuietDays({ days }: { days: number[] }) {
  const { t, i18n } = useTranslation();
  const weekday = (day: number) => new Date(day * 1000).toLocaleDateString(i18n.language, { weekday: "long" });
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <p className="dense-text flex items-baseline gap-2 text-ink-600">
      <span className="font-semibold text-ink-500">
        {first === last ? weekday(first) : `${weekday(first)} – ${weekday(last)}`}
      </span>
      <span>· {t("calendar.emptyDay")}</span>
      <span className="section-rule self-center" />
    </p>
  );
}

/** A day of the stacked views: a dated header, then tiles or rows; an empty today says so in one muted line. */
function DaySection({
  day,
  isToday,
  slots,
  now,
  tiles,
}: {
  day: number;
  isToday: boolean;
  slots: Slot[];
  now: number;
  tiles: boolean;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(day * 1000);
  return (
    <section
      aria-label={
        date.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" }) +
        (isToday ? ` · ${t("calendar.today")}` : "")
      }
    >
      <header className="mb-2 flex items-baseline gap-2">
        <span className={cn("dense-text-lg font-bold", isToday ? "text-accent-400" : "text-ink-100")}>
          {date.toLocaleDateString(i18n.language, { weekday: "long" })}
        </span>
        <span className={cn("dense-text tabular-nums", isToday ? "text-accent-400" : "text-ink-600")}>
          {date.toLocaleDateString(i18n.language, { day: "numeric", month: "short" })}
        </span>
        {isToday && (
          <span className="dense-text uppercase tracking-eyebrow text-accent-400">{t("calendar.today")}</span>
        )}
        <span className="section-rule" />
      </header>
      {slots.length === 0 ? (
        <p className="dense-text px-2.5 text-ink-600">{t("calendar.emptyDay")}</p>
      ) : tiles ? (
        <div className="dense-tiles gap-2.5">
          {slots.map((s) => (
            <CalendarTile key={s.key} slot={s} state={stateOf(s, now)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {slots.map((s) => (
            <CalendarAgendaRow key={s.key} slot={s} state={stateOf(s, now)} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The on-list pip: a check for watched (or, upcoming, simply on the list), a hollow ring for an aired episode still owed. */
function StateMarker({ slot, state }: { slot: Slot; state: ReleaseState }) {
  const { t } = useTranslation();
  if (!slot.entry) return null;
  if (state === "unwatched") {
    return (
      <span
        title={t("calendar.unwatched")}
        className="grid size-3.5 shrink-0 place-items-center rounded-full bg-accent-500/15 text-accent-400"
      >
        <Circle className="size-2" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      title={state === "watched" ? t("calendar.watched") : t(`status.ANIME.${slot.entry.status}`)}
      className="grid size-3.5 shrink-0 place-items-center rounded-full bg-success/15 text-success"
    >
      <Check className="size-2.5" />
    </span>
  );
}

/** A poster-first tile for the tiles view; the time strip sits on the art so the title gets the whole width below. */
function CalendarTile({ slot, state }: { slot: Slot; state: ReleaseState }) {
  const { t, i18n } = useTranslation();
  const title = displayTitle(slot.media.title);
  const released = state !== "upcoming";
  return (
    <Link
      to={`/media/${slot.media.id}`}
      title={title}
      className={cn(
        "group flex flex-col gap-1.5 rounded-control transition-surface",
        released && "opacity-55 hover:opacity-100",
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-control bg-surface-800">
        <img
          src={slot.media.coverImage.large ?? ""}
          alt=""
          loading="lazy"
          className={cn("size-full object-cover", released && "grayscale-[.5] group-hover:grayscale-0")}
        />
        <p className="dense-text absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-surface-950/80 px-1.5 py-1 backdrop-blur-sm">
          <span className="tabular-nums text-accent-400">
            {new Date(slot.airingAt * 1000).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-ink-300">{t("calendar.ep", { n: slot.episode })}</span>
          <span className="ml-auto">
            <StateMarker slot={slot} state={state} />
          </span>
        </p>
      </div>
      <p className="dense-text-lg line-clamp-2 px-0.5 font-medium leading-snug text-ink-100">{title}</p>
    </Link>
  );
}

/** One line of the agenda view: a digest row with the time on the right and the state as its marker. */
function CalendarAgendaRow({ slot, state }: { slot: Slot; state: ReleaseState }) {
  const { t, i18n } = useTranslation();
  return (
    <DigestRow
      media={slot.media}
      note={t("calendar.ep", { n: slot.episode })}
      when={new Date(slot.airingAt * 1000).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
      marker={<StateMarker slot={slot} state={state} />}
      dim={state !== "upcoming"}
    />
  );
}

function DayColumn({
  day,
  isToday,
  slots,
  now,
}: {
  day: number;
  isToday: boolean;
  slots: Slot[];
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(day * 1000);

  return (
    <section
      aria-label={
        date.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" }) +
        (isToday ? ` · ${t("calendar.today")}` : "")
      }
      className={cn(
        "flex min-h-72 flex-col rounded-panel border p-1.5",
        isToday
          ? "border-accent-600/50 bg-accent-500/[.07]"
          : "border-hair bg-surface-900/40",
      )}
    >
      <header className="flex items-baseline justify-between gap-1 px-1 pb-1.5 pt-0.5">
        <span
          className={cn(
            "text-2xs font-semibold uppercase tracking-eyebrow",
            isToday ? "text-accent-400" : "text-ink-600",
          )}
        >
          {date.toLocaleDateString(i18n.language, { weekday: "short" })}
        </span>
        <span
          className={cn(
            "text-sm font-bold tabular-nums",
            isToday ? "text-accent-400" : "text-ink-300",
          )}
        >
          {date.toLocaleDateString(i18n.language, { day: "numeric" })}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-1">
        {slots.map((s) => (
          <CalendarCard key={s.key} slot={s} state={stateOf(s, now)} />
        ))}
      </div>
    </section>
  );
}

/** One airing in a day cell, stacked where `DigestRow` spreads, because a row is the wrong shape for a column. */
function CalendarCard({ slot, state }: { slot: Slot; state: ReleaseState }) {
  const { t, i18n } = useTranslation();
  const title = displayTitle(slot.media.title);
  const released = state !== "upcoming";

  return (
    <Link
      to={`/media/${slot.media.id}`}
      title={title}
      className={cn(
        "flex gap-1.5 rounded-control bg-surface-900 p-1.5 transition-surface hover:bg-surface-850",
        released && "opacity-55 hover:opacity-100",
      )}
    >
      <img
        src={slot.media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="dense-cover shrink-0 rounded-inner object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="dense-text flex items-center gap-1 leading-tight">
          <span className="tabular-nums text-accent-400">
            {new Date(slot.airingAt * 1000).toLocaleTimeString(i18n.language, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="text-ink-600">{t("calendar.ep", { n: slot.episode })}</span>
          <span className="ml-auto">
            <StateMarker slot={slot} state={state} />
          </span>
        </p>
        <p className="dense-text mt-0.5 line-clamp-2 leading-tight text-ink-100">
          {title}
        </p>
      </div>
    </Link>
  );
}
