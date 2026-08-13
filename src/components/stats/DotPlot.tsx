import { scaleLinear } from "d3-scale";
import { Card, CardTitle } from "@/components/ui/card";
import { motionDuration, seriesDelay } from "@/lib/motion";

/**
 * A dumbbell plot: two scores per row on one 0–max axis, joined by a line
 * whose length *is* the disagreement. `max` is the score scale's top —
 * ten by default, whatever the account's format renders otherwise.
 *
 * Built for "my score against the community's" — the one figure AniList's
 * own statistics cannot draw, since it never sees both numbers side by side.
 * The mine-dot carries the accent; the community sits in the neutral graph
 * tone, the same "not yours" colour the sunburst uses for its remainder.
 */
export interface DotPlotRow {
  label: string;
  mine: number;
  other: number;
}

export function DotPlot({
  title,
  hint,
  rows,
  legendMine,
  legendOther,
  max = 10,
}: {
  title: string;
  hint?: string;
  rows: DotPlotRow[];
  legendMine: string;
  legendOther: string;
  max?: number;
}) {
  if (rows.length === 0) return null;
  const X = scaleLinear().domain([0, max]).range([3, 97]).clamp(true);

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>}

      <div className="mt-4 flex flex-1 flex-col justify-around gap-3">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-300">{r.label}</span>
              <span className="shrink-0 tabular-nums text-ink-100">
                {r.other.toFixed(1)}
                <span className="mx-1 text-ink-600">→</span>
                {r.mine.toFixed(1)}
              </span>
            </div>
            <svg
              className="mt-1 h-3 w-full chart-in"
              viewBox="0 0 100 12"
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ animationDelay: `${motionDuration(seriesDelay(i, rows.length))}ms` }}
            >
              {/* The axis, faint, so a lone pair still reads as a position. */}
              <line x1="3" y1="6" x2="97" y2="6" stroke="var(--color-surface-800)" strokeWidth="1" />
              <line
                x1={X(r.other)}
                y1="6"
                x2={X(r.mine)}
                y2="6"
                stroke="var(--color-surface-600)"
                strokeWidth="2"
              />
              <circle cx={X(r.other)} cy="6" r="3" fill="var(--color-graph-none)" />
              <circle cx={X(r.mine)} cy="6" r="3.5" fill="var(--color-accent-400)" />
            </svg>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4 text-2xs text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--color-accent-400)" }} />
          {legendMine}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--color-graph-none)" }} />
          {legendOther}
        </span>
      </div>
    </Card>
  );
}
