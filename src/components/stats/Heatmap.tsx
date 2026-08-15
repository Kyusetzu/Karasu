import { scaleQuantize } from "d3-scale";
import { Card, CardTitle } from "@/components/ui/card";
import type { HeatmapYear } from "@/lib/localStats";
import { motionDuration, seriesDelay } from "@/lib/motion";

/**
 * A year × month activity grid — when the list was actually being worked on.
 *
 * Intensity is the accent at five quantized opacities over `--accent-rgb`, so
 * the whole grid follows the theme; an empty cell keeps the surface tone,
 * which reads as "quiet month" rather than "missing data". Every non-empty
 * cell carries its count in a `title`, and the busiest month is the scale's
 * honest top rather than a fixed guess.
 */
const ALPHAS = [0.14, 0.32, 0.5, 0.7, 0.92];

export function Heatmap({
  title,
  hint,
  years,
  max,
  monthLabels,
}: {
  title: string;
  hint?: string;
  years: HeatmapYear[];
  max: number;
  /** Twelve short month names in the user's locale, January first. */
  monthLabels: string[];
}) {
  if (years.length === 0) return null;
  const alpha = scaleQuantize<number>().domain([1, Math.max(max, 1)]).range(ALPHAS);

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>}

      {/* Colour *is* the data here — the cells carry nothing but their
          opacity — so Windows High Contrast leaves this subtree alone. See the
          `forced-colors` block in `index.css`. */}
      <div data-keep-colors className="mt-4 space-y-1">
        <div className="grid grid-cols-[2.5rem_repeat(12,1fr)] gap-1">
          <span />
          {monthLabels.map((m, i) => (
            <span key={i} className="text-center text-2xs text-ink-600">
              {m}
            </span>
          ))}
        </div>
        {years.map((row, yi) => (
          <div
            key={row.year}
            className="chart-in grid grid-cols-[2.5rem_repeat(12,1fr)] gap-1"
            style={{ animationDelay: `${motionDuration(seriesDelay(yi, years.length))}ms` }}
          >
            <span className="self-center text-2xs tabular-nums text-ink-500">{row.year}</span>
            {row.months.map((count, mi) => (
              <span
                key={mi}
                title={count > 0 ? `${monthLabels[mi]} ${row.year} · ${count}` : undefined}
                className="aspect-square rounded-[.1875rem] bg-surface-800"
                style={
                  count > 0
                    ? { background: `rgba(var(--accent-rgb), ${alpha(count)})` }
                    : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
