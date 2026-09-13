import { Card, CardTitle } from "@/components/ui/card";
import { TONES } from "@/components/stats/Charts";
import { distributionColumns } from "@/lib/score";
import { cn } from "@/lib/utils";
/** Score distribution, one column per step to `max`; the axis is the scale's, never inferred from the data. */
export function ScoreColumns({
  title,
  hint,
  data,
  max,
}: {
  title: string;
  hint: string;
  data: { score: number; count: number }[];
  /** The display scale's top, from `scoreScale(format).max`. */
  max: number;
}) {
  const columns = distributionColumns(data, max);
  if (columns.length === 0) return null;
  const peak = Math.max(...columns.map((c) => c.count), 1);
  // Accent from three quarters of the scale's top, so the tail reads the same on every score format.
  const high = columns[columns.length - 1].step * 0.75;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      <p className="mt-1 text-2xs text-ink-600">{hint}</p>
      {/* `flex-1` absorbs the row's slack; keep `items-stretch`, or the columns stay content-sized and it pools above. */}
      <div className="mt-4 flex flex-1 items-stretch gap-1.75">
        {columns.map(({ step, count }) => {
          return (
            <div key={step} className="flex flex-1 flex-col items-center gap-1">
              {/* Fixed height; an empty span is zero-height and would lift this column's bar off the shared baseline. */}
              <span className="h-3 text-2xs leading-3 tabular-nums text-ink-600">
                {count || ""}
              </span>
              {/* Out of flow on purpose; in flow the percentage height resolves against the box's `auto` and the bar vanishes. */}
              <div className="relative min-h-32 w-full flex-1">
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 rounded-t-[.1875rem]",
                    // The Wrapped poster's accent gradient as a column; the high scores carry the light.
                    step >= high
                      ? "bg-gradient-to-t from-accent-600 to-accent-400"
                      : "bg-surface-700",
                  )}
                  // A zero still draws a hairline, so it reads as none at this score rather than as a missing column.
                  style={{ height: `${Math.max((count / peak) * 100, 1)}%` }}
                />
              </div>
              <span className="h-3 text-2xs leading-3 tabular-nums text-ink-500">
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Statuses as one stacked bar plus a legend, the shape of the list rather than five separate counts. */
export function StatusBar({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
  // The shared categorical ramp; a local copy is how two ramps start disagreeing.
  const tone = TONES;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {/* `data-keep-colors` on the painted spans, never a wrapper; it inherits and would freeze the text too. */}
      <div className="mt-4 flex h-2 shrink-0 overflow-hidden rounded-full bg-surface-800">
        {data.map((d, i) => (
          <span
            key={d.label}
            data-keep-colors
            title={`${d.label}: ${d.count}`}
            style={{
              width: `${(d.count / total) * 100}%`,
              background: tone[i % tone.length],
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span
              data-keep-colors
              className="size-2 shrink-0 rounded-[.125rem]"
              style={{ background: tone[i % tone.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-500">{d.label}</span>
            <span className="shrink-0 tabular-nums text-ink-300">{d.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Stat tiles in the Wrapped poster's register: a short accent rule over bare figures, no card fill. */
export function TileGrid({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="relative pt-2.5">
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-0.5 w-9 rounded-full bg-gradient-to-r from-accent-500 to-accent-400/25"
          />
          <p className="text-2xl font-bold tabular-nums text-ink-100">{tile.value}</p>
          <p className="mt-0.5 text-2xs uppercase tracking-[.08em] text-ink-600">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

export function DistributionCard({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {/* `justify-around` rather than a fixed stack, so a taller grid row spreads the rows through the slack. */}
      <div className="mt-3 flex flex-1 flex-col justify-around gap-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate text-ink-500">{d.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-surface-800">
              <div
                // Switching ANIME/MANGA re-measures the bars rather than cutting to the new lengths.
                className="h-full rounded bg-accent-500 transition-[width] duration-(--duration-expressive) ease-out-expo"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums text-ink-500">
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
