import { Fragment } from "react";
import {
  arcPath,
  linePoints,
  pointsAttr,
  polar,
  radarPoints,
  slices,
  squarify,
} from "@/lib/charts";

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
export function Sunburst({ data, size = 220 }: { data: Slice[]; size?: number }) {
  const c = size / 2;
  const inner = size * 0.17;
  const mid = size * 0.3;
  const outer = size * 0.46;
  const arcs = slices(data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-56">
      {data.map((group, i) => {
        const tone = TONES[i % TONES.length];
        const span = arcs[i];
        const kids = group.children ?? [];
        const kidArcs = slices(kids.map((k) => k.value));
        const width = span.end - span.start;
        return (
          <Fragment key={group.label}>
            <path
              d={arcPath(c, c, inner, mid, span.start, span.end)}
              fill={tone}
              stroke="var(--color-surface-900)"
              strokeWidth={1}
            >
              <title>{`${group.label}: ${group.value}`}</title>
            </path>
            {kids.map((kid, j) => {
              // The child's slice is its share of the parent's own wedge.
              const from = span.start + (kidArcs[j].start / 360) * width;
              const to = span.start + (kidArcs[j].end / 360) * width;
              return (
                <path
                  key={kid.label}
                  d={arcPath(c, c, mid + 1, outer, from, to)}
                  fill={tone}
                  opacity={Math.max(0.28, 0.82 - j * 0.13)}
                  stroke="var(--color-surface-900)"
                  strokeWidth={1}
                >
                  <title>{`${group.label} · ${kid.label}: ${kid.value}`}</title>
                </path>
              );
            })}
          </Fragment>
        );
      })}
      <text
        x={c}
        y={c + 4}
        textAnchor="middle"
        className="fill-ink-300 text-[.75rem] font-semibold tabular-nums"
      >
        {total}
      </text>
    </svg>
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
  size = 220,
}: {
  axes: { label: string; value: number }[];
  size?: number;
}) {
  const c = size / 2;
  const r = size * 0.34;
  const max = Math.max(...axes.map((a) => a.value), 1);
  const shape = radarPoints(
    axes.map((a) => a.value),
    max,
    c,
    c,
    r,
  );

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-64">
      {[0.25, 0.5, 0.75, 1].map((step) => (
        <polygon
          key={step}
          points={pointsAttr(radarPoints(axes.map(() => 1), 1, c, c, r * step))}
          fill="none"
          stroke="var(--color-surface-800)"
          strokeWidth={1}
        />
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
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--color-accent-400)">
          <title>{`${axes[i].label}: ${axes[i].value}`}</title>
        </circle>
      ))}
      {axes.map((axis, i) => {
        const at = polar(c, c, r + size * 0.1, (i * 360) / axes.length);
        return (
          <text
            key={axis.label}
            x={at.x}
            y={at.y + 3}
            textAnchor="middle"
            className="fill-ink-600 text-[.5625rem]"
          >
            {axis.label.length > 12 ? `${axis.label.slice(0, 11)}…` : axis.label}
          </text>
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
  height = 96,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const W = 300;
  const pad = 6;
  const pts = linePoints(
    data.map((d) => d.value),
    W - pad * 2,
    height - pad * 2,
  ).map((p) => ({ x: p.x + pad, y: p.y + pad }));
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <polygon
          points={`${pad},${height - pad} ${pointsAttr(pts)} ${W - pad},${height - pad}`}
          fill="rgba(var(--accent-rgb), .14)"
        />
        <polyline
          points={pointsAttr(pts)}
          fill="none"
          stroke="var(--color-accent-500)"
          strokeWidth={2}
          // The line keeps its weight when the viewBox is stretched to the
          // panel's width, which `preserveAspectRatio: none` would otherwise
          // smear along with everything else.
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} fill="var(--color-accent-400)">
            <title>{`${data[i].label}: ${data[i].value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-ink-600">
        <span>{data[0]?.label}</span>
        <span className="text-ink-500">{max}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
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
  height = 180,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const W = 320;
  const items = data.filter((d) => d.value > 0);
  const rects = squarify(
    items.map((d) => d.value),
    W,
    height,
  );

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
      {rects.map((r, i) => (
        <g key={items[i].label}>
          <rect
            x={r.x}
            y={r.y}
            width={Math.max(0, r.w - 1)}
            height={Math.max(0, r.h - 1)}
            rx={3}
            fill={TONES[i % TONES.length]}
            opacity={Math.max(0.35, 1 - i * 0.06)}
          >
            <title>{`${items[i].label}: ${items[i].value}`}</title>
          </rect>
          {r.w > 52 && r.h > 22 && (
            <>
              <text
                x={r.x + 6}
                y={r.y + 14}
                className="fill-ink-100 text-[.5625rem] font-medium"
              >
                {items[i].label.length > Math.floor(r.w / 5)
                  ? `${items[i].label.slice(0, Math.floor(r.w / 5))}…`
                  : items[i].label}
              </text>
              <text
                x={r.x + 6}
                y={r.y + 25}
                className="fill-ink-300 text-[.5rem] tabular-nums"
              >
                {items[i].value}
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
