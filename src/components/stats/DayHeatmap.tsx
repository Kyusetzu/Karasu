import { Card, CardTitle } from "@/components/ui/card";
import { HISTORY_LEVELS, type DayHeatmap as DayHeatmapData } from "@/lib/localStats";
import { seriesDelay } from "@/lib/motion";

/** One opacity per AniList `level`; bucketing by `amount` locally would disagree with the website. */
const ALPHAS = [0.14, 0.32, 0.5, 0.7, 0.92];

/** AniList's level to an opacity. Anything unexpected lands at the bottom. */
function alphaFor(level: number): number {
  const i = HISTORY_LEVELS.indexOf(level as (typeof HISTORY_LEVELS)[number]);
  return ALPHAS[i === -1 ? 0 : i];
}

/** AniList's activity history, one cell per day and weeks as columns; deliberately not a mode of `Heatmap`. */
export function DayHeatmap({
  title,
  hint,
  data,
  monthLabels,
  dayLabels,
  formatDay,
  rangeLabel,
  legendLess,
  legendMore,
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
  /** The span and total, spelled out; AniList's window is not a year and must not be left to a hover. */
  rangeLabel: string;
  /** The two ends of the legend. */
  legendLess: string;
  legendMore: string;
}) {
  if (data.weeks.length === 0) return null;

  const monthAt = new Map(data.months.map((m) => [m.column, m.month]));

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>}

      {/* Scrolls in its own container, never the page body; cells shrunk to fit a year are unreadable. */}
      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {/* The weekday axis: the same h-3 band and fixed-height rows as every column; `grid-rows-7` drifted the cells. */}
          <div className="mr-1 flex shrink-0 flex-col gap-1">
            <span className="h-3" />
            {dayLabels.map((d, i) => (
              <span
                key={i}
                className="flex h-3 items-center justify-end text-2xs leading-none text-ink-600"
              >
                {i % 2 === 1 ? d : ""}
              </span>
            ))}
          </div>

          {data.weeks.map((week, wi) => {
            const month = monthAt.get(wi);
            return (
              <div
                key={wi}
                className="chart-in flex flex-col gap-1"
                style={{
                  animationDelay: `${seriesDelay(wi, data.weeks.length)}ms`,
                }}
              >
                {/* The month band rides on its own column, so it stays aligned when the grid scrolls sideways. */}
                <span className="h-3 overflow-visible whitespace-nowrap text-2xs leading-none text-ink-600">
                  {month !== undefined ? monthLabels[month] : ""}
                </span>
                {week.map((cell, di) => (
                  <span
                    key={di}
                    // On the cell, not a wrapper; `forced-color-adjust` inherits and would freeze the axis labels too.
                    data-keep-colors
                    title={
                      cell && cell.amount > 0
                        ? `${formatDay(cell.day)} · ${cell.amount}`
                        : undefined
                    }
                    className={
                      cell
                        ? "size-3 rounded-mark bg-surface-800"
                        : "size-3 rounded-mark"
                    }
                    style={
                      cell && cell.level > 0
                        ? { background: `rgba(var(--accent-rgb), ${alphaFor(cell.level)})` }
                        : undefined
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Visible rather than discoverable, so what the shading means and what it covers never needs a hover. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-2xs text-ink-600">{rangeLabel}</span>
        <span className="flex items-center gap-1 text-2xs text-ink-600">
          {legendLess}
          {ALPHAS.map((a) => (
            <span
              key={a}
              data-keep-colors
              className="size-3 rounded-mark"
              style={{ background: `rgba(var(--accent-rgb), ${a})` }}
            />
          ))}
          {legendMore}
        </span>
      </div>
    </Card>
  );
}
