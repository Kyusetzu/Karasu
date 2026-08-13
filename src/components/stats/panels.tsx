import { Card, CardTitle } from "@/components/ui/card";
import { TONES } from "@/components/stats/Charts";
import { cn } from "@/lib/utils";
/**
 * Score distribution as ten columns.
 *
 * Vertical rather than the horizontal bars everything else uses, because the
 * axis is the score itself and it runs 1–10 whether or not every step has
 * entries. 8–10 take the accent: the shape of the tail is the interesting
 * part — whether you are a generous scorer — and colour says it faster than
 * reading the counts.
 */
export function ScoreColumns({
  title,
  hint,
  data,
}: {
  title: string;
  hint: string;
  data: { score: number; count: number }[];
}) {
  if (data.length === 0) return null;
  const by = new Map(data.map((d) => [d.score, d.count]));
  // AniList lets a user score on 3, 5, 10 or 100 points and the payload only
  // carries the buckets in use, so the axis is inferred from the highest one:
  // a five-point list must not be drawn as half of a ten-column chart, and a
  // hundred-point list must not be drawn as a hundred columns.
  const top = Math.max(...data.map((d) => d.score), 0);
  const scale = top <= 3 ? 3 : top <= 5 ? 5 : top <= 10 ? 10 : 0;
  const steps = scale
    ? Array.from({ length: scale }, (_, i) => i + 1)
    : data.map((d) => d.score);
  const max = Math.max(...data.map((d) => d.count), 1);
  const high = Math.max(...steps) * 0.75;

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
        {steps.map((step) => {
          const count = by.get(step) ?? 0;
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
                    step >= high ? "bg-accent-500" : "bg-surface-700",
                  )}
                  // A count of zero still draws a hairline, so the gap reads as
                  // "none at this score" rather than as a missing column.
                  style={{ height: `${Math.max((count / max) * 100, 1)}%` }}
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
      <div className="mt-4 flex h-2 shrink-0 overflow-hidden rounded-full bg-surface-800">
        {data.map((d, i) => (
          <span
            key={d.label}
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
 * Release years as a sparkline, every other year written under the bars.
 *
 * Sixteen four-digit labels across half a card collide, so past nine bars only
 * every second one is written — counted back from the newest, not forward from
 * the oldest. The newest year is the one the accent highlights and the one a
 * reader looks for first, and an even number of bars would otherwise leave it
 * as the blank column. The cost is the oldest year losing its label instead,
 * which is the cheaper end to lose.
 */
export function YearSparkline({
  title,
  data,
}: {
  title: string;
  data: { year: number; count: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const recent = data.length - 3;
  // Sixteen four-digit years across half a screen collide, so every other one
  // is written and the rest keep their column. The counts above the bars are
  // one or two digits and always fit, which is why they are never thinned.
  const everyOther = data.length > 9;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {/* Stretched for the same reason as the score columns — see there. */}
      <div className="mt-4 flex flex-1 items-stretch gap-1">
        {data.map((d, i) => (
          <div key={d.year} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            {/* Both label slots keep their height when they hold nothing.
                They are written conditionally — a year with no entries prints
                no count, and past nine bars only every second year is named —
                and an empty span is a zero-height box. With the row
                bottom-aligned, the columns whose labels were blank sat lower
                than the rest, so the bars had no common floor and the missing
                labels left a visible notch under every other year. */}
            <span className="h-3 text-[.5625rem] leading-3 tabular-nums text-ink-500">
              {d.count || ""}
            </span>
            {/* Out of flow for the same reason as the score columns: this box
                is sized by `flex-1`, so an in-flow percentage height has no
                definite containing block to resolve against and collapses. */}
            <div className="relative min-h-24 w-full flex-1">
              <div
                title={`${d.year}: ${d.count}`}
                className={cn(
                  "absolute inset-x-0 bottom-0 rounded-t-[.125rem]",
                  i >= recent ? "bg-accent-500" : "bg-surface-700",
                )}
                style={{ height: `${Math.max((d.count / max) * 100, 2)}%` }}
              />
            </div>
            <span className="h-3 text-[.5625rem] leading-3 tabular-nums text-ink-600">
              {!everyOther || (data.length - 1 - i) % 2 === 0 ? d.year : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TileGrid({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-surface-800 bg-surface-900 px-4 py-3"
        >
          <p className="text-xl font-bold tabular-nums">{tile.value}</p>
          <p className="text-xs text-ink-600">{tile.label}</p>
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
