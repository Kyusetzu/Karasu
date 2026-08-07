import { Fragment } from "react";
import {
  arcPath,
  linePoints,
  pointsAttr,
  polar,
  radarPoints,
  slices,
  polylineLength,
  squarify,
} from "@/lib/charts";
import { motionDuration, staggerDelay } from "@/lib/motion";

/**
 * When a line-chart point should land: as the drawing line reaches it.
 *
 * Spread across most of the 900ms draw so the last point is not still arriving
 * after the line has finished, and through `motionDuration` because a delay is
 * one of the things the reduce-motion CSS deliberately does *not* neutralise
 * for us — see `lib/motion.ts`.
 */
function pointDelay(index: number, count: number): number {
  if (count <= 1) return 0;
  return motionDuration(Math.round((index / (count - 1)) * 780));
}

/**
 * The categorical ramp: the accent leading, then the surface steps.
 *
 * Deliberately not a rainbow. Karasu has one colour of its own and the rest of
 * the interface is grey, so a chart that invents six hues reads as a different
 * application — and the hues would carry meanings (green good, red bad) that
 * "Drama" and "TV Short" do not have.
 */
export const TONES = [
  "var(--color-accent-500)",
  "var(--color-accent-400)",
  "var(--color-surface-600)",
  "var(--color-surface-700)",
  "var(--color-surface-800)",
  "var(--color-graph-none)",
];

/**
 * The ink for text drawn on top of `TONES[i]`.
 *
 * Only the first two tones are the accent, and only they need `accent-ink` —
 * the derived colour that reads on whatever the user picked, which for a pale
 * accent is near-black and for a dark one near-white. On the surface greys the
 * same ink is a coin flip, so those take a fixed light ink instead.
 *
 * Deliberately `i` and not `i % TONES.length`: the treemap fades later tiles
 * with `opacity`, so tiles 6 and 7 wear the accent hue at 0.6 over surface-900
 * and are grey in practice. Judging them by their tone index would put
 * near-black text on a near-black tile.
 */
export const onAccent = (i: number) => (i < 2 ? "fill-accent-ink" : "fill-ink-300");

export interface Slice {
  label: string;
  value: number;
  children?: { label: string; value: number }[];
}

/**
 * A sunburst: one ring of groups, one of their parts.
 *
 * The point is the second ring — a pie says how the list splits, a sunburst
 * says how each of those splits again, which is the question "what am I
 * actually watching" needs two levels to answer.
 *
 * Children inherit their parent's colour and step down in opacity rather than
 * taking a colour of their own, so the eye reads the outer ring as belonging
 * to the inner one instead of as a second, unrelated chart.
 */
export function Sunburst({ data, size = 260 }: { data: Slice[]; size?: number }) {
  const c = size / 2;
  const inner = size * 0.17;
  const mid = size * 0.32;
  const outer = size * 0.49;
  const arcs = slices(data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full">
      {data.map((group, i) => {
        const tone = TONES[i % TONES.length];
        const span = arcs[i];
        const kids = group.children ?? [];
        const kidArcs = slices(kids.map((k) => k.value));
        const width = span.end - span.start;
        return (
          <Fragment key={group.label}>
            {/* Arcs arrive in ring order. Deliberately a scale from the
                slice's own centre rather than a sweep: a sweep would cross
                `ArcValue`'s 26-degree label threshold on the way, popping
                the number in partway through. */}
            <path
              d={arcPath(c, c, inner, mid, span.start, span.end)}
              fill={tone}
              stroke="var(--color-surface-900)"
              strokeWidth={1}
              className="chart-in"
              style={{ animationDelay: `${staggerDelay(i)}ms` }}
            >
              <title>{`${group.label}: ${group.value}`}</title>
            </path>
            {/* `accent-ink` is the readable ink *for the accent colour*, and
                only the first two tones are accent — the rest are surface
                greys. `readableInk` picks whichever of near-black and
                near-white contrasts with the accent, which is not the same
                question as what reads on a grey. It happens to come out right
                for seven of the eighteen accent/theme combinations, the
                default among them; for the other eleven it lands at 1.0–1.9:1
                and the number is not there at all. */}
            <ArcValue
              c={c}
              r={(inner + mid) / 2}
              from={span.start}
              to={span.end}
              value={group.value}
              tone={i < 2 ? "fill-accent-ink" : "fill-ink-100"}
            />
            {/* The outer ring is the same hue stepped down in opacity, so it is
                mostly card underneath and takes the light ink throughout. */}
            {kids.map((kid, j) => {
              // The child's slice is its share of the parent's own wedge.
              const from = span.start + (kidArcs[j].start / 360) * width;
              const to = span.start + (kidArcs[j].end / 360) * width;
              return (
                <Fragment key={kid.label}>
                  <path
                    d={arcPath(c, c, mid + 1, outer, from, to)}
                    fill={tone}
                    opacity={Math.max(0.28, 0.82 - j * 0.13)}
                    stroke="var(--color-surface-900)"
                    strokeWidth={1}
                  >
                    <title>{`${group.label} · ${kid.label}: ${kid.value}`}</title>
                  </path>
                  <ArcValue
                    c={c}
                    r={(mid + outer) / 2}
                    from={from}
                    to={to}
                    value={kid.value}
                    tone="fill-ink-100"
                  />
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
      <text
        x={c}
        y={c + 4}
        textAnchor="middle"
        className="fill-ink-300 text-[1.0625rem] font-semibold tabular-nums"
      >
        {total}
      </text>
    </svg>
  );
}

/**
 * A count written inside its own wedge, where the wedge can hold it.
 *
 * The threshold is in degrees rather than pixels because that is what decides
 * whether the number fits: a thin ring segment is thin at every chart size.
 * Below it the arc keeps its tooltip and the legend still carries the figure,
 * so nothing is only-on-hover — it is just not written twice.
 */
function ArcValue({
  c,
  r,
  from,
  to,
  value,
  tone,
}: {
  c: number;
  r: number;
  from: number;
  to: number;
  value: number;
  tone: string;
}) {
  if (to - from < 26) return null;
  const at = polar(c, c, r, (from + to) / 2);
  return (
    <text
      x={at.x}
      y={at.y + 3}
      textAnchor="middle"
      className={`${tone} pointer-events-none text-[.6875rem] font-medium tabular-nums`}
    >
      {value}
    </text>
  );
}

/** A legend for whatever the sunburst or the stacked bar just drew. */
export function ToneLegend({ items }: { items: { label: string; value: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          <span
            className="size-2 shrink-0 rounded-[.125rem]"
            style={{ background: TONES[i % TONES.length] }}
          />
          <span className="min-w-0 flex-1 truncate text-ink-500">{item.label}</span>
          <span className="shrink-0 tabular-nums text-ink-300">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A radar — the shape of a taste rather than its ranking.
 *
 * Six bars sorted by count answer "which genre is biggest", which the top
 * genres list already answers. The polygon answers a different question: how
 * lopsided the taste is. A spike is a specialist, a hexagon is an omnivore,
 * and neither reads off a bar chart at a glance.
 */
export function RadarChart({
  axes,
  size = 260,
}: {
  axes: { label: string; value: number }[];
  size?: number;
}) {
  const c = size / 2;
  const r = size * 0.32;
  const max = Math.max(...axes.map((a) => a.value), 1);
  const shape = radarPoints(
    axes.map((a) => a.value),
    max,
    c,
    c,
    r,
  );

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((step) => (
        <polygon
          key={step}
          points={pointsAttr(radarPoints(axes.map(() => 1), 1, c, c, r * step))}
          fill="none"
          stroke="var(--color-surface-800)"
          strokeWidth={1}
        />
      ))}
      {/* What the rings are worth. Without a scale the polygon says only
          "lopsided"; with one it also says how many, which is the difference
          between a shape and a measurement. */}
      {[0.5, 1].map((step) => (
        <text
          key={step}
          x={c + 3}
          y={c - r * step + 3}
          className="fill-ink-600 text-[.4375rem] tabular-nums"
        >
          {Math.round(max * step)}
        </text>
      ))}
      {axes.map((axis, i) => {
        const end = polar(c, c, r, (i * 360) / axes.length);
        return (
          <line
            key={axis.label}
            x1={c}
            y1={c}
            x2={end.x}
            y2={end.y}
            stroke="var(--color-surface-800)"
            strokeWidth={1}
          />
        );
      })}
      <polygon
        points={pointsAttr(shape)}
        fill="rgba(var(--accent-rgb), .22)"
        stroke="var(--color-accent-500)"
        strokeWidth={1.5}
      />
      {shape.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill="var(--color-accent-400)"
          className="chart-in"
          style={{ animationDelay: `${staggerDelay(i)}ms` }}
        >
          <title>{`${axes[i].label}: ${axes[i].value}`}</title>
        </circle>
      ))}
      {axes.map((axis, i) => {
        const at = polar(c, c, r + size * 0.115, (i * 360) / axes.length);
        return (
          <Fragment key={axis.label}>
            <text
              x={at.x}
              y={at.y}
              textAnchor="middle"
              className="fill-ink-500 text-[.5625rem]"
            >
              {axis.label.length > 12 ? `${axis.label.slice(0, 11)}…` : axis.label}
            </text>
            {/* The count under its own axis label, so the shape and the
                numbers are read in one place instead of one on hover. */}
            <text
              x={at.x}
              y={at.y + 9}
              textAnchor="middle"
              className="fill-ink-300 text-[.5625rem] font-medium tabular-nums"
            >
              {axis.value}
            </text>
          </Fragment>
        );
      })}
    </svg>
  );
}

/**
 * A line over time.
 *
 * Bars invite comparison between neighbours; a line says the values are one
 * series that continues — which is the truth about years, and why a gap year
 * has to sit on the floor rather than leave the frame.
 */
export function LineChart({
  data,
  height = 150,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const W = 620;
  const padX = 14;
  // Room above the line for a value and below it for the year, so neither has
  // to overlap the series to be read.
  const top = 16;
  const bottom = 20;
  const pts = linePoints(
    data.map((d) => d.value),
    W - padX * 2,
    height - top - bottom,
  ).map((p) => ({ x: p.x + padX, y: p.y + top }));
  const floor = height - bottom;
  // Summed from the geometry rather than read back with `getTotalLength()`,
  // which would mean measuring the DOM after mount and drawing one frame of
  // a line that is already complete.
  const length = polylineLength(pts);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full">
      <polygon
        points={`${padX},${floor} ${pointsAttr(pts)} ${W - padX},${floor}`}
        fill="rgba(var(--accent-rgb), .14)"
        className="animate-fade-in"
      />
      {/* Drawn rather than appearing. A line chart is a shape the eye
          follows left to right anyway, so letting it arrive that way costs
          nothing and says "this is a series over time" before the axis
          labels are read. */}
      <polyline
        points={pointsAttr(pts)}
        fill="none"
        stroke="var(--color-accent-500)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        style={{
          strokeDasharray: length,
          ["--draw-length" as string]: length,
          animation: "drawLine 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      />
      {pts.map((p, i) => (
        <Fragment key={data[i].label}>
          {/* Each point lands as the line reaches it, so the labels do not
              all appear over a line that is still drawing. */}
          <g
            className="chart-in"
            style={{ animationDelay: `${pointDelay(i, pts.length)}ms` }}
          >
          <circle cx={p.x} cy={p.y} r={2.5} fill="var(--color-accent-400)" />
          {/* Every point carries its own count. The old footer showed the
              series maximum between the two end years, which read as a third
              year rather than as a value. */}
          <text
            x={p.x}
            y={p.y - 7}
            textAnchor="middle"
            className="fill-ink-300 text-[.5625rem] font-medium tabular-nums"
          >
            {data[i].value}
          </text>
          <text
            x={p.x}
            y={height - 6}
            textAnchor="middle"
            className="fill-ink-600 text-[.5625rem] tabular-nums"
          >
            {data[i].label}
          </text>
          </g>
        </Fragment>
      ))}
    </svg>
  );
}

/**
 * A treemap — area for count, so the long tail is visible instead of being a
 * list of rows that all look the same length.
 *
 * Labels are drawn only where the tile can hold them; a clipped word in a
 * 12px box is noise, and the tooltip has the name either way.
 */
export function Treemap({
  data,
  width = 1000,
  height = 300,
}: {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
}) {
  const items = data.filter((d) => d.value > 0);
  const rects = squarify(
    items.map((d) => d.value),
    width,
    height,
  );

  // No fixed pixel height and no `preserveAspectRatio` override: the viewBox's
  // own ratio is what the SVG scales to. It used to be laid out 320 wide and
  // then pinned to 180px tall, so in a full-width card the default
  // `xMidYMid meet` fitted 320×180 into 1000×180 — a 1:1 scale, drawn in the
  // middle, with two thirds of the card left empty on either side.
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {rects.map((r, i) => {
        // Roughly 5.4 viewBox units per character at this size — enough to
        // decide whether a name fits rather than clipping it mid-word.
        const fits = Math.floor((r.w - 14) / 5.4);
        const label = items[i].label;
        const named = r.w > 44 && r.h > 30;
        const numbered = !named && r.w > 26 && r.h > 14;
        return (
          <g
            key={label}
            className="chart-in"
            style={{ animationDelay: `${staggerDelay(i)}ms` }}
          >
            <rect
              x={r.x}
              y={r.y}
              width={Math.max(0, r.w - 2)}
              height={Math.max(0, r.h - 2)}
              rx={4}
              fill={TONES[i % TONES.length]}
              opacity={Math.max(0.35, 1 - i * 0.06)}
            >
              <title>{`${label}: ${items[i].value}`}</title>
            </rect>
            {named && (
              <>
                <text
                  x={r.x + 7}
                  y={r.y + 17}
                  className={`${onAccent(i)} text-[.625rem] font-medium`}
                >
                  {label.length > fits ? `${label.slice(0, Math.max(1, fits))}…` : label}
                </text>
                <text
                  x={r.x + 7}
                  y={r.y + 30}
                  className={`${onAccent(i)} text-[.625rem] tabular-nums`}
                >
                  {items[i].value}
                </text>
              </>
            )}
            {/* Too narrow for a name but wide enough for a figure: the tile
                still says how big it is rather than being a blank rectangle
                you have to hover to identify. */}
            {numbered && (
              <text
                x={r.x + r.w / 2}
                y={r.y + r.h / 2 + 3}
                textAnchor="middle"
                className={`${onAccent(i)} text-[.5625rem] tabular-nums`}
              >
                {items[i].value}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
