import { Card, CardTitle } from "@/components/ui/card";
import { TONES } from "@/components/stats/Charts";
import { distributionColumns } from "@/lib/score";
import { cn } from "@/lib/utils";
/**
 * Score distribution as one column per step of the account's scale.
 *
 * Vertical rather than the horizontal bars everything else uses, because the
 * axis is the score itself and it runs the full scale whether or not every
 * step has entries. The top quarter takes the accent: the shape of the tail
 * is the interesting part — whether you are a generous scorer — and colour
 * says it faster than reading the counts.
 *
 * The axis comes from `max` (the display scale's top) rather than being
 * inferred from the data — the bucketing rules, and why they are not
 * defensive paranoia, live with `distributionColumns`.
 */
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
  // Accent when step >= 0.75 × the scale's top — 8–10 on ten, 80–100 on
  // the hundred-point deciles.
  const high = columns[columns.length - 1].step * 0.75;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      <p className="mt-1 text-2xs text-ink-600">{hint}</p>
      {/* `flex-1` so the columns take whatever height the grid row gives this
          card. A bar drawn in percentages is the one chart here that *can*
          grow, so it absorbs the slack instead of leaving a hole under it. */}
      {/* `items-stretch`, not `items-end`: bottom-aligning the columns leaves
          them content-sized, so the plot area below could never grow past its
          own min-height and the card's extra row height pooled above the bars.
          Stretching is only safe because every column now has the same fixed
          label slots top and bottom — otherwise it would be the thing that
          broke the shared baseline. */}
      <div className="mt-4 flex flex-1 items-stretch gap-1.75">
        {columns.map(({ step, count }) => {
          return (
            <div key={step} className="flex flex-1 flex-col items-center gap-1">
              {/* Fixed height, not `{count || ""}` alone: an empty span is a
                  zero-height box, so a score with no entries made its column
                  shorter than its neighbours — and with the row bottom-aligned
                  that lifted the *bar* off the shared baseline. */}
              <span className="h-3 text-2xs leading-3 tabular-nums text-ink-600">
                {count || ""}
              </span>
              {/* The bar is out of flow on purpose. This box gets its height
                  from `flex-1`, so its `height` property is still `auto` — and
                  a percentage height resolves against the *computed* height,
                  not the used one. As an in-flow child the bar therefore
                  computed to `auto`, which for an empty div is 0px, and the
                  whole chart vanished. Out of flow the percentage resolves
                  against the containing block's used height, which is definite
                  once flex layout has run. */}
              <div className="relative min-h-32 w-full flex-1">
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 rounded-t-[.1875rem]",
                    // The Wrapped poster's accent gradient, as a column: the
                    // high scores carry the light and the ramp gives them depth
                    // a flat fill did not have.
                    step >= high
                      ? "bg-gradient-to-t from-accent-600 to-accent-400"
                      : "bg-surface-700",
                  )}
                  // A count of zero still draws a hairline, so the gap reads as
                  // "none at this score" rather than as a missing column.
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

/**
 * Statuses as one stacked bar plus a legend.
 *
 * Five separate bars answer "how many are paused"; one stacked bar answers
 * "what does my list look like", which is the question this panel is on the
 * page for.
 */
export function StatusBar({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
  // The shared categorical ramp — this used to be a local copy of `TONES`,
  // which is exactly how two ramps start disagreeing.
  const tone = TONES;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {/* `data-keep-colors` on the painted spans, never on a wrapper: the
          property inherits, so a wrapper would freeze this card's *text* at the
          dark theme's ink too — near-white labels on a forced light palette.
          Each segment is identified only by its tone, so those do have to keep
          ours. See the `forced-colors` block in `index.css`. */}
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

/**
 * The stat tiles, in the Wrapped poster's register: a short accent rule over
 * bare figures, no card fill. A bordered box at this density read as six UI
 * cards competing with the charts below; the rule marks each figure without
 * boxing it. (`YearSparkline` used to live here — the Years tab's AreaChart
 * superseded it.)
 */
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
      {/* `justify-around` rather than a fixed stack: when the grid row is
          taller than this card needs, the rows spread through the slack
          instead of leaving it pooled under the last one. */}
      <div className="mt-3 flex flex-1 flex-col justify-around gap-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate text-ink-500">{d.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-surface-800">
              <div
                // Only fires when the figure changes — switching ANIME/MANGA
                // re-measures the bars rather than cutting to new lengths.
                className="h-full rounded bg-accent-500 transition-[width] duration-[280ms] ease-out-expo"
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
