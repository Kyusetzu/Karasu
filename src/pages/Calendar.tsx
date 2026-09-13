import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { airingWeek, type AiringSlot } from "@/api/queries";
import { fetchMediaList, isTauri, saveText } from "@/api/anilist";
import { buildIcs } from "@/lib/ical";
import { IconButton } from "@/components/ui/icon-button";
import { displayTitle, type Media, type MediaListEntry } from "@/api/types";
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
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

/** The two lenses: "mine" projects the cached list for free, "all" is a bounded `Page.airingSchedules` fetch. */

type Lens = "mine" | "all";

/** One rendered row, whichever lens produced it. */
interface Slot {
  key: string;
  airingAt: number;
  episode: number;
  media: Pick<Media, "id" | "title" | "coverImage">;
  entry: MediaListEntry | null;
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

  // Fetched only under the "all" lens, and not keyed on the filter level, so a filter change costs nothing.
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
          {/* The export is the slots the grid draws, with stable UIDs so a re-export updates instead of duplicating. */}
          {slots.length > 0 && (
            <IconButton
              variant="ghost"
              size="control"
              onClick={() =>
                void saveText(
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
                )
              }
              aria-label={t("calendar.exportIcs")}
              title={t("calendar.exportIcs")}
            >
              <Download className="size-4" />
            </IconButton>
          )}
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

      {/* `overflow-auto`, not `-y-`: seven fixed-minimum columns outgrow a narrow window and must scroll. */}
      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        {error ? (
          <p className="text-sm text-danger">{t("common.error", { message: String(error) })}</p>
        ) : loading ? (
          <div className="grid min-w-[980px] grid-cols-7 gap-2" aria-hidden="true">
            {days.map((day, i) => (
              <Shimmer key={day} className="h-72 rounded-xl" index={i} />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <EmptyState
            visual={<TickMarks />}
            title={t(lens === "mine" ? "calendar.emptyMine" : "calendar.emptyAll")}
            hint={lens === "mine" ? t("calendar.emptyMineHint") : undefined}
          />
        ) : (
          <div className="grid min-w-[980px] grid-cols-7 items-stretch gap-2">
            {days.map((day, i) => (
              <DayColumn
                key={day}
                day={day}
                isToday={day === todayMidnight}
                slots={buckets[i]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DayColumn({
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
    <section
      aria-label={
        date.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" }) +
        (isToday ? ` · ${t("calendar.today")}` : "")
      }
      className={cn(
        "flex min-h-72 flex-col rounded-xl border p-1.5",
        isToday
          ? "border-accent-600/50 bg-accent-500/[.07]"
          : "border-surface-800 bg-surface-900/40",
      )}
    >
      <header className="flex items-baseline justify-between gap-1 px-1 pb-1.5 pt-0.5">
        <span
          className={cn(
            "text-2xs font-semibold uppercase tracking-[.1em]",
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
          <CalendarCard key={s.key} slot={s} />
        ))}
      </div>
    </section>
  );
}

/** One airing in a day cell, stacked where `DigestRow` spreads, because a row is the wrong shape for a column. */
function CalendarCard({ slot }: { slot: Slot }) {
  const { t, i18n } = useTranslation();
  const title = displayTitle(slot.media.title);

  return (
    <Link
      to={`/media/${slot.media.id}`}
      title={title}
      className="flex gap-1.5 rounded-lg bg-surface-900 p-1.5 transition-surface hover:bg-surface-850"
    >
      <img
        src={slot.media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="h-7 w-5 shrink-0 rounded-[.25rem] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-2xs leading-tight">
          <span className="tabular-nums text-accent-400">
            {new Date(slot.airingAt * 1000).toLocaleTimeString(i18n.language, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="text-ink-600">{t("calendar.ep", { n: slot.episode })}</span>
          {slot.entry && (
            <span
              title={t(`status.ANIME.${slot.entry.status}`)}
              className="ml-auto grid size-3.5 shrink-0 place-items-center rounded-full bg-success/15 text-success"
            >
              <Check className="size-2.5" />
            </span>
          )}
        </p>
        <p className="mt-0.5 line-clamp-2 text-2xs leading-tight text-ink-200">
          {title}
        </p>
      </div>
    </Link>
  );
}
