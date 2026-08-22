import { Card, CardTitle } from "@/components/ui/card";
import { HISTORY_LEVELS, type DayHeatmap as DayHeatmapData } from "@/lib/localStats";
import { motionDuration, seriesDelay } from "@/lib/motion";

/**
 * AniList's own activity history, drawn the way AniList draws it: one cell per
 * day, weeks as columns, weekdays as rows.
 *
 * Separate from `Heatmap` rather than a mode of it. That one is a year × month
 * grid built from the *local* list's start and completion dates, and it is
 * still what local mode and an empty history get — the two answer different
 * questions from different data, and folding them together would mean one
 * component whose every branch belonged to only one of its callers.
 *
 * **Intensity is AniList's `level`, not a local threshold.** It reports 1, 3,
 * 5, 7, 9 — five buckets, which is exactly the number of opacities here, so the
 * mapping is an index rather than a scale. Re-deriving buckets from `amount`
 * would be a second opinion about a question the API already answered, which is
 * how the app and the website come to disagree about the same account.
 */
const ALPHAS = [0.14, 0.32, 0.5, 0.7, 0.92];

/** AniList's level to an opacity. Anything unexpected lands at the bottom. */
function alphaFor(level: number): number {
  const i = HISTORY_LEVELS.indexOf(level as (typeof HISTORY_LEVELS)[number]);
  return ALPHAS[i === -1 ? 0 : i];
}

export function DayHeatmap({
  title,
  hint,
  data,
  monthLabels,
  dayLabels,
  formatDay,
}: {
  title: string;
  hint?: string;
  data: DayHeatmapData;
  /** Twelve short month names in the user's locale, January first. */
  monthLabels: string[];
  /** Seven short weekday names, **Monday first** — see `dayHeatmapFromHistory`. */
  dayLabels: string[];
  /** A cell's date for its tooltip, in the user's locale. */
  formatDay: (daySeconds: number) => string;
}) {
  if (data.weeks.length === 0) return null;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>}

      {/* A year of weeks does not fit a panel at any sensible cell size, and
          shrinking the cells to make it fit is how this becomes unreadable.
          Scrolls in its own container so the page body never does — the rule
          the wide tables already follow. */}
      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {/* The weekday axis. Every other label only: seven three-letter names
              stacked at cell height is a wall, and Mon/Wed/Fri is the reading
              GitHub's grid established. */}
          <div className="mr-1 grid shrink-0 grid-rows-7 gap-1 pt-4">
            {dayLabels.map((d, i) => (
              <span
                key={i}
                className="h-3 text-right text-[.5625rem] leading-3 text-ink-600"
              >
                {i % 2 === 1 ? d : ""}
              </span>
            ))}
          </div>

          {data.weeks.map((week, wi) => (
            <div
              key={wi}
              className="chart-in grid grid-rows-7 gap-1"
              style={{
                animationDelay: `${motionDuration(seriesDelay(wi, data.weeks.length))}ms`,
              }}
            >
              {/* The month axis rides on the column it belongs to, so it stays
                  aligned when the grid scrolls. */}
              <span className="mb-1 h-3 text-[.5625rem] leading-3 text-ink-600">
                {data.months.find((m) => m.column === wi)
                  ? monthLabels[data.months.find((m) => m.column === wi)!.month]
                  : ""}
              </span>
              {week.map((cell, di) => (
                <span
                  key={di}
                  // On the cell, not a wrapper: `forced-color-adjust` inherits,
                  // and a wrapper would freeze the axis labels at the dark
                  // theme's ink. Same reasoning as `Heatmap`.
                  data-keep-colors
                  title={
                    cell && cell.amount > 0
                      ? `${formatDay(cell.day)} · ${cell.amount}`
                      : undefined
                  }
                  className={
                    cell
                      ? "size-3 rounded-[.1875rem] bg-surface-800"
                      : "size-3 rounded-[.1875rem]"
                  }
                  style={
                    cell && cell.level > 0
                      ? { background: `rgba(var(--accent-rgb), ${alphaFor(cell.level)})` }
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
