import { area, curveMonotoneX, line } from "d3-shape";
import { scaleLinear, scalePoint } from "d3-scale";
import { seriesDelay } from "@/lib/motion";

/**
 * A smoothed area over time — `LineChart`'s successor for year series.
 *
 * `curveMonotoneX` rather than a spline: it interpolates smoothly but never
 * overshoots, so a year of zero cannot dip the curve below the floor and a
 * spike cannot ring past its own value. The geometry comes from d3-shape and
 * d3-scale; the rendering, the palette and the motion stay the house's.
 *
 * The draw-on uses `pathLength={1}`: a curve's true length is not knowable
 * without measuring the DOM, and normalizing the path to length 1 lets the
 * same dash trick work in pure markup. (The old warning about
 * `non-scaling-stroke` does not apply — nothing here moves the stroke into
 * screen space.)
 */
export function AreaChart({
  data,
  height = 150,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  if (data.length < 2) return null;

  const W = 620;
  const padX = 14;
  const top = 16;
  const bottom = 20;
  const floor = height - bottom;

  const x = scalePoint<string>()
    .domain(data.map((d) => d.label))
    .range([padX, W - padX]);
  const y = scaleLinear()
    .domain([0, Math.max(...data.map((d) => d.value), 1)])
    .range([floor, top]);

  const pts = data.map((d) => ({ x: x(d.label) ?? 0, y: y(d.value) }));
  const areaPath = area<{ x: number; y: number }>()
    .x((p) => p.x)
    .y0(floor)
    .y1((p) => p.y)
    .curve(curveMonotoneX)(pts);
  const linePath = line<{ x: number; y: number }>()
    .x((p) => p.x)
    .y((p) => p.y)
    .curve(curveMonotoneX)(pts);

  return (
    <svg data-chart viewBox={`0 0 ${W} ${height}`} className="w-full">
      <path d={areaPath ?? ""} fill="rgba(var(--accent-rgb), .14)" className="animate-fade-in" />
      <path
        d={linePath ?? ""}
        fill="none"
        stroke="var(--color-accent-500)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          ["--draw-length" as string]: 1,
          animation: "drawLine 900ms var(--ease-out-expo) forwards",
        }}
      />
      {pts.map((p, i) => (
        <g
          key={data[i].label}
          className="chart-in"
          style={{ animationDelay: `${seriesDelay(i, pts.length)}ms` }}
        >
          <circle cx={p.x} cy={p.y} r={2.5} fill="var(--color-accent-400)" />
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
      ))}
    </svg>
  );
}
