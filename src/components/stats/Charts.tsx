import { Fragment } from "react";
import {
  arcPath,
  pointsAttr,
  polar,
  radarPoints,
  slices,
  squarify,
} from "@/lib/charts";
import { motionDuration, seriesDelay } from "@/lib/motion";

/** The categorical ramp, accent first then surface greys; a rainbow would imply meanings the data lacks. */
export const TONES = [
  "var(--color-accent-500)",
  "var(--color-accent-400)",
  "var(--color-surface-600)",
  "var(--color-surface-700)",
  "var(--color-surface-800)",
  "var(--color-graph-none)",
];

/** Ink over `TONES[i]`; keep the bare `i`, later treemap tiles fade to grey where accent ink vanishes. */
export const onAccent = (i: number) => (i < 2 ? "fill-accent-ink" : "fill-ink-300");

export interface Slice {
  label: string;
  value: number;
  children?: { label: string; value: number }[];
}

/** A sunburst of groups and their parts; children inherit the parent's hue stepped down in opacity. */
export function Sunburst({ data, size = 260 }: { data: Slice[]; size?: number }) {
  const c = size / 2;
  const inner = size * 0.17;
  const mid = size * 0.32;
  const outer = size * 0.49;
  const arcs = slices(data.map((d) => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <svg data-chart viewBox={`0 0 ${size} ${size}`} className="w-full">
      {data.map((group, i) => {
        const tone = TONES[i % TONES.length];
        const span = arcs[i];
        const kids = group.children ?? [];
        const kidArcs = slices(kids.map((k) => k.value));
        const width = span.end - span.start;
        return (
          <Fragment key={group.label}>
            {/* Wedge and number arrive as one `<g>`, scaled not swept so the sweep cannot cross `ArcValue`'s threshold. */}
            <g
              className="chart-in"
              style={{ animationDelay: `${seriesDelay(i, data.length)}ms` }}
            >
              <path
                d={arcPath(c, c, inner, mid, span.start, span.end)}
                fill={tone}
                stroke="var(--color-surface-900)"
                strokeWidth={1}
              >
                <title>{`${group.label}: ${group.value}`}</title>
              </path>
              {/* `accent-ink` fits the accent alone, so only the first two tones take it and the greys get a fixed ink. */}
              <ArcValue
                c={c}
                r={(inner + mid) / 2}
                from={span.start}
                to={span.end}
                value={group.value}
                tone={i < 2 ? "fill-accent-ink" : "fill-ink-100"}
              />
            </g>
            {/* The outer ring is the parent's hue faded over the card, so it takes the light ink throughout. */}
            {kids.map((kid, j) => {
              // The child's slice is its share of the parent's own wedge.
              const from = span.start + (kidArcs[j].start / 360) * width;
              const to = span.start + (kidArcs[j].end / 360) * width;
              return (
                <g
                  key={kid.label}
                  className="chart-in"
                  style={{
                    animationDelay: `${
                      seriesDelay(i, data.length) +
                      seriesDelay(j + 1, kids.length + 1) / 2
                    }ms`,
                  }}
                >
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
                </g>
              );
            })}
          </Fragment>
        );
      })}
      <text
        x={c}
        y={c + 4}
        textAnchor="middle"
        className="animate-fade-in fill-ink-300 text-[1.0625rem] font-semibold tabular-nums"
      >
        {total}
      </text>
    </svg>
  );
}

/** A count inside its own wedge, gated in degrees because a thin segment is thin at every chart size. */
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

/** A radar shows the shape of a taste, not its ranking: a spike is a specialist, a hexagon an omnivore. */
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
    <svg data-chart viewBox={`0 0 ${size} ${size}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((step) => (
        <polygon
          key={step}
          points={pointsAttr(radarPoints(axes.map(() => 1), 1, c, c, r * step))}
          fill="none"
          stroke="var(--color-surface-800)"
          strokeWidth={1}
        />
      ))}
      {/* What the rings are worth; without a scale the polygon is a shape rather than a measurement. */}
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
      {/* The rings and axes are the frame and are simply there; the polygon is the data, so it arrives. */}
      <g className="chart-in">
        <polygon
          points={pointsAttr(shape)}
          fill="rgba(var(--accent-rgb), .22)"
          stroke="var(--color-accent-500)"
          strokeWidth={1.5}
        />
      </g>
      {shape.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          fill="var(--color-accent-400)"
          className="chart-in"
          // After the polygon, so the vertices land on a shape already in place rather than racing it.
          style={{
            animationDelay: `${motionDuration(90) + seriesDelay(i, shape.length)}ms`,
          }}
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
            {/* The count under its own axis label, so the numbers read beside the shape instead of on hover. */}
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

// `LineChart` lived here until `AreaChart` superseded it; nothing that dashes a stroke may put it into screen space.

/** A treemap, area for count so the long tail shows; labels only where the tile can hold them. */
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

  // No pixel height and no `preserveAspectRatio` override; a pinned height leaves most of a wide card empty.
  return (
    <svg data-chart viewBox={`0 0 ${width} ${height}`} className="w-full">
      {rects.map((r, i) => {
        // ViewBox units per character, enough to decide whether a name fits rather than clip it mid-word.
        const fits = Math.floor((r.w - 14) / 5.4);
        const label = items[i].label;
        const named = r.w > 44 && r.h > 30;
        const numbered = !named && r.w > 26 && r.h > 14;
        return (
          <g
            key={label}
            className="chart-in"
            // Keep `seriesDelay`; `staggerDelay`'s cycle restarts mid-chart and the arrival visibly stalls.
            style={{ animationDelay: `${seriesDelay(i, rects.length)}ms` }}
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
            {/* Too narrow for a name but wide enough for a figure, so the tile still says how big it is. */}
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
