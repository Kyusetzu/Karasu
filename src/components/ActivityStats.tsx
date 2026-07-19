import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getHistory, isTauri, type HistoryRow } from "@/api/anilist";
import { Card, CardTitle } from "@/components/ui/card";

// Static class strings so Tailwind keeps them; index = intensity level 0–4.
const LEVELS = [
  "bg-surface-800",
  "bg-accent-500/25",
  "bg-accent-500/45",
  "bg-accent-500/70",
  "bg-accent-500",
];

function level(count: number, max: number): string {
  if (count <= 0) return LEVELS[0];
  const step = Math.ceil((count / Math.max(max, 1)) * 4);
  return LEVELS[Math.min(step, 4)];
}

const DAY_MS = 86_400_000;
const CALENDAR_DAYS = 371; // 53 weeks

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Karasu-only playback analytics computed from the local history log. */
export default function ActivityStats() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: () => getHistory(0),
    enabled: isTauri,
  });

  const agg = useMemo(() => aggregate(data ?? []), [data]);

  if (isLoading) return <p className="text-ink-500">{t("common.loading")}</p>;
  if (!data || data.length === 0)
    return <p className="text-sm text-ink-600">{t("stats.activityEmpty")}</p>;

  const weekdayNames = weekdayLabels(i18n.language);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("stats.episodesTracked")} value={String(agg.total)} />
        <Tile label={t("stats.hoursTracked")} value={agg.hours.toFixed(1)} />
        <Tile label={t("stats.activeDays")} value={String(agg.activeDays)} />
        <Tile
          label={t("stats.longestStreak")}
          value={t("stats.streakDays", { n: agg.longestStreak })}
        />
      </div>

      <Card>
        <CardTitle>{t("stats.whenYouWatch")}</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <div className="inline-block">
            <div className="flex">
              <div className="w-8 shrink-0" />
              <div className="flex">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="w-3.5 text-center text-[9px] tabular-nums text-ink-600"
                  >
                    {h % 6 === 0 ? h : ""}
                  </div>
                ))}
              </div>
            </div>
            {agg.weekdayHour.map((row, wd) => (
              <div key={wd} className="flex items-center">
                <div className="w-8 shrink-0 text-[10px] text-ink-500">
                  {weekdayNames[wd]}
                </div>
                <div className="flex">
                  {row.map((count, h) => (
                    <div key={h} className="p-px">
                      <div
                        className={`h-3.5 w-3 rounded-sm ${level(count, agg.hourMax)}`}
                        title={`${weekdayNames[wd]} ${h}:00 — ${count}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>{t("stats.calendarTitle")}</CardTitle>
        <div className="mt-3 overflow-x-auto">
          <div
            className="grid grid-flow-col gap-1"
            style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
          >
            {agg.calendar.map((cell, i) =>
              cell === null ? (
                <div key={i} className="h-3 w-3" />
              ) : (
                <div
                  key={i}
                  className={`h-3 w-3 rounded-sm ${level(cell.count, agg.dayMax)}`}
                  title={`${cell.date} — ${cell.count}`}
                />
              ),
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900 px-4 py-3">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-ink-600">{label}</p>
    </div>
  );
}

interface Aggregates {
  total: number;
  hours: number;
  activeDays: number;
  longestStreak: number;
  weekdayHour: number[][]; // [7][24]
  hourMax: number;
  calendar: ({ date: string; count: number } | null)[];
  dayMax: number;
}

function aggregate(rows: HistoryRow[]): Aggregates {
  const weekdayHour: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  const perDay = new Map<string, number>();
  let hourMax = 0;
  let seconds = 0;

  for (const r of rows) {
    const d = new Date(r.endedMs);
    const wd = (d.getDay() + 6) % 7; // Monday = 0
    weekdayHour[wd][d.getHours()] += 1;
    hourMax = Math.max(hourMax, weekdayHour[wd][d.getHours()]);
    perDay.set(dayKey(d), (perDay.get(dayKey(d)) ?? 0) + 1);
    seconds += r.seconds;
  }

  // Calendar grid: leading blanks so the first column starts on Monday.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (CALENDAR_DAYS - 1) * DAY_MS);
  const lead = (start.getDay() + 6) % 7;
  const calendar: ({ date: string; count: number } | null)[] = [];
  for (let i = 0; i < lead; i++) calendar.push(null);
  let dayMax = 0;
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const count = perDay.get(dayKey(d)) ?? 0;
    dayMax = Math.max(dayMax, count);
    calendar.push({ date: d.toLocaleDateString(), count });
  }

  return {
    total: rows.length,
    hours: seconds / 3600,
    activeDays: perDay.size,
    longestStreak: longestStreak(perDay),
    weekdayHour,
    hourMax,
    calendar,
    dayMax,
  };
}

/** Longest run of consecutive calendar days with at least one event. */
function longestStreak(perDay: Map<string, number>): number {
  const days = [...perDay.keys()]
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const t of days) {
    run = prev && t - prev === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

function weekdayLabels(locale: string): string[] {
  // Monday-first short weekday names in the active locale.
  const monday = new Date(2024, 0, 1); // Jan 1 2024 is a Monday
  return Array.from({ length: 7 }, (_, i) =>
    new Date(monday.getTime() + i * DAY_MS).toLocaleDateString(locale, {
      weekday: "short",
    }),
  );
}
