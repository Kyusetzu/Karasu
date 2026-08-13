/**
 * Chart geometry — the maths behind the statistics panels, kept out of the
 * components so it can be tested without a DOM.
 *
 * Everything here works in SVG user units with y running down, and angles in
 * degrees measured clockwise from twelve o'clock, which is how a reader
 * describes a pie slice.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function polar(cx: number, cy: number, r: number, deg: number): Point {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * One ring segment — the building block of both a donut and a sunburst.
 *
 * A full circle is drawn as two half arcs: a single arc whose start and end
 * points coincide is a no-op in SVG, so a category holding everything would
 * otherwise vanish rather than fill the ring.
 */
export function arcPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const sweep = Math.abs(a1 - a0);
  if (sweep >= 359.999) {
    const half = a0 + 180;
    return [
      ring(cx, cy, r1, a0, half),
      ring(cx, cy, r1, half, a0 + 359.999),
      "Z",
      ring(cx, cy, r0, a0, half),
      ring(cx, cy, r0, half, a0 + 359.999),
      "Z",
    ].join(" ");
  }
  const outerStart = polar(cx, cy, r1, a0);
  const outerEnd = polar(cx, cy, r1, a1);
  const innerEnd = polar(cx, cy, r0, a1);
  const innerStart = polar(cx, cy, r0, a0);
  const large = sweep > 180 ? 1 : 0;
  return [
    `M${outerStart.x},${outerStart.y}`,
    `A${r1},${r1} 0 ${large} 1 ${outerEnd.x},${outerEnd.y}`,
    `L${innerEnd.x},${innerEnd.y}`,
    `A${r0},${r0} 0 ${large} 0 ${innerStart.x},${innerStart.y}`,
    "Z",
  ].join(" ");
}

function ring(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const from = polar(cx, cy, r, a0);
  const to = polar(cx, cy, r, a1);
  return `M${from.x},${from.y} A${r},${r} 0 0 1 ${to.x},${to.y}`;
}

/** Slice boundaries for a set of values laid round a full turn. */
export function slices(values: number[]): { start: number; end: number }[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => ({ start: 0, end: 0 }));
  let at = 0;
  return values.map((v) => {
    const start = at;
    at += (Math.max(0, v) / total) * 360;
    return { start, end: at };
  });
}

/**
 * The corners of a radar polygon, one axis per value, starting at the top.
 *
 * `max` is passed in rather than derived so several series can share a scale;
 * a zero max collapses to the centre instead of dividing by it.
 */
export function radarPoints(
  values: number[],
  max: number,
  cx: number,
  cy: number,
  r: number,
): Point[] {
  const step = 360 / Math.max(1, values.length);
  return values.map((v, i) =>
    polar(cx, cy, max > 0 ? (Math.max(0, v) / max) * r : 0, i * step),
  );
}

export const pointsAttr = (points: Point[]): string =>
  points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");

// `linePoints` and `polylineLength` lived here for the hand-rolled LineChart;
// the Years tab's AreaChart gets both from d3-shape (`curveMonotoneX` and
// `pathLength` normalization), so they left with their consumer.

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Squarified treemap.
 *
 * Rows are grown while adding the next value improves the worst aspect ratio
 * in the row, then laid along the shorter side — the standard Bruls/Huizing/
 * van Wijk construction. Naive slice-and-dice is a third of the code and
 * produces slivers, which is the one thing a treemap must not do: a shape
 * that thin carries no area impression at all.
 *
 * Values are assumed sorted descending; zero and negative values are dropped
 * by the caller, since a rectangle with no area is not a fact worth drawing.
 */
export function squarify(values: number[], w: number, h: number): Rect[] {
  const out: Rect[] = [];
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0 || w <= 0 || h <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  // Work in area units so a value maps straight onto a rectangle.
  const areas = values.map((v) => (v / total) * w * h);
  let x = 0;
  let y = 0;
  let free = { w, h };
  let index = 0;

  while (index < areas.length) {
    const short = Math.min(free.w, free.h);
    const row: number[] = [];
    let rowArea = 0;

    // Grow the row while the worst aspect ratio keeps improving.
    while (index + row.length < areas.length) {
      const next = areas[index + row.length];
      if (row.length > 0 && worst(row, rowArea, short) < worst([...row, next], rowArea + next, short)) {
        break;
      }
      row.push(next);
      rowArea += next;
    }

    const thickness = rowArea / short;
    let along = 0;
    for (const area of row) {
      const length = area / thickness;
      out.push(
        free.w >= free.h
          ? { x, y: y + along, w: thickness, h: length }
          : { x: x + along, y, w: length, h: thickness },
      );
      along += length;
    }

    if (free.w >= free.h) {
      x += thickness;
      free = { w: free.w - thickness, h: free.h };
    } else {
      y += thickness;
      free = { w: free.w, h: free.h - thickness };
    }
    index += row.length;
  }

  return out;
}

/** Worst aspect ratio in a row of areas laid across a side of length `side`. */
function worst(row: number[], sum: number, side: number): number {
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}
