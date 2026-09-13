import { useId } from "react";
import { scaleLinear } from "d3-scale";
import { max } from "d3-array";
import { Card, CardTitle } from "@/components/ui/card";
import { seriesDelay } from "@/lib/motion";

/** Accent-gradient bars, one row per labelled value; `domain` pins the axis so a score bar is not scaled to its top row. */
export function GradientBars({
  title,
  hint,
  rows,
  domain,
}: {
  title: string;
  hint?: string;
  rows: { label: string; value: number; text: string; sub?: string }[];
  domain?: number;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (rows.length === 0) return null;

  const top = domain ?? max(rows, (r) => r.value) ?? 1;
  const x = scaleLinear().domain([0, top]).range([0, 100]).clamp(true);

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>{title}</CardTitle>
      {hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>}
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent-600)" />
            <stop offset="100%" stopColor="var(--color-accent-400)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-4 flex flex-1 flex-col justify-around gap-2.5">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-ink-300">{r.label}</span>
              <span className="shrink-0 tabular-nums text-ink-100">
                {r.text}
                {r.sub && <span className="ml-1.5 text-2xs text-ink-600">{r.sub}</span>}
              </span>
            </div>
            <svg
              data-chart
              className="mt-1 h-2 w-full"
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect x="0" y="0" width="100" height="8" rx="3" className="fill-surface-800" />
              <rect
                x="0"
                y="0"
                width={Math.max(x(r.value), 1)}
                height="8"
                rx="3"
                fill={`url(#${gradientId})`}
                className="chart-in"
                style={{ animationDelay: `${seriesDelay(i, rows.length)}ms` }}
              />
            </svg>
          </div>
        ))}
      </div>
    </Card>
  );
}
