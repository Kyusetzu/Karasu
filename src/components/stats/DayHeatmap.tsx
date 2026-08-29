import { Card, CardTitle } from "@/components/ui/card";
import { HISTORY_LEVELS, type DayHeatmap as DayHeatmapData } from "@/lib/localStats";
import { seriesDelay } from "@/lib/motion";

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
 *
 * **Layout is flex columns with fixed heights, not `grid-rows-7`.** The first
 * version put the month label *inside* a `grid-rows-7` column as an eighth
 * child, so the last weekday spilled into an implicit row, every `1fr` row
 * inflated to the label's height while the axis column's rows did not, and the
 * cells drifted ~4px further from their weekday labels with every row. Fixed
 * heights make the alignment arithmetic, not negotiation: the month row is one
 * `h-3` band above the grid for every column including the axis, and each day
 * cell is `size-3` everywhere.
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
  /**
   * What the grid covers and how much it holds, spelled out — AniList's
   * history window is not a year, and the range must not be left to
   * implication (or to hovering).
   */
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

      {/* A year of weeks does not fit a panel at any sensible cell size, and
          shrinking the cells to make it fit is how this becomes unreadable.
          Scrolls in its own container so the page body never does — the rule
          the wide tables already follow. */}
      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {/* The weekday axis: an h-3 spacer where the other columns carry
              their month label, then seven rows at exactly cell height.
              Every other label only — seven three-letter names stacked at
              12px is a wall, and Mon/Wed/Fri is the reading GitHub's grid
              established. */}
          <div className="mr-1 flex shrink-0 flex-col gap-1">
            <span className="h-3" />
            {dayLabels.map((d, i) => (
              <span
                key={i}
                className="flex h-3 items-center justify-end text-[.5625rem] leading-none text-ink-600"
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
                {/* The month band rides on the column it belongs to, so it
                    stays aligned when the grid scrolls sideways. */}
                <span className="h-3 overflow-visible whitespace-nowrap text-[.5625rem] leading-none text-ink-600">
                  {month !== undefined ? monthLabels[month] : ""}
                </span>
                {week.map((cell, di) => (
                  <span
                    key={di}
                    // On the cell, not a wrapper: `forced-color-adjust`
                    // inherits, and a wrapper would freeze the axis labels at
                    // the dark theme's ink. Same reasoning as `Heatmap`.
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
            );
          })}
        </div>
      </div>

      {/* The legend, visible rather than discoverable: the tooltips carry the
          per-day counts, but what the shading *means* and what span the grid
          covers must be readable without pointing at anything. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-2xs text-ink-600">{rangeLabel}</span>
        <span className="flex items-center gap-1 text-2xs text-ink-600">
          {legendLess}
          {ALPHAS.map((a) => (
            <span
              key={a}
              data-keep-colors
              className="size-3 rounded-[.1875rem]"
              style={{ background: `rgba(var(--accent-rgb), ${a})` }}
            />
          ))}
          {legendMore}
        </span>
      </div>
    </Card>
  );
}
