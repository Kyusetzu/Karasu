import { describe, expect, it } from "vitest";
import { arcPath, polar, radarPoints, slices, squarify } from "./charts";

describe("polar", () => {
  it("starts at twelve o'clock and runs clockwise", () => {
    const top = polar(0, 0, 10, 0);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(-10);
    const right = polar(0, 0, 10, 90);
    expect(right.x).toBeCloseTo(10);
    expect(right.y).toBeCloseTo(0);
  });
});

describe("slices", () => {
  it("divides the turn in proportion", () => {
    const [a, b] = slices([3, 1]);
    expect(a.start).toBe(0);
    expect(a.end).toBeCloseTo(270);
    expect(b.end).toBeCloseTo(360);
  });

  it("collapses to nothing when every value is zero", () => {
    expect(slices([0, 0])).toEqual([
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ]);
  });
});

describe("arcPath", () => {
  it("draws a wedge with both radii", () => {
    const d = arcPath(50, 50, 20, 40, 0, 90);
    expect(d).toMatch(/^M/);
    expect(d).toContain("A40,40");
    expect(d).toContain("A20,20");
  });

  it("flags the long way round past a half turn", () => {
    expect(arcPath(0, 0, 5, 10, 0, 200)).toContain("0 1 1");
    expect(arcPath(0, 0, 5, 10, 0, 100)).toContain("0 0 1");
  });

  it("draws a full ring as two arcs", () => {
    // One arc back to its own start point renders nothing at all, so a
    // category holding everything would silently disappear.
    const d = arcPath(0, 0, 5, 10, 0, 360);
    expect(d.match(/A10,10/g)?.length).toBe(2);
    expect(d.match(/A5,5/g)?.length).toBe(2);
  });
});

describe("radarPoints", () => {
  it("puts the first axis at the top and scales to the max", () => {
    const [first] = radarPoints([5, 1, 1], 10, 0, 0, 100);
    expect(first.x).toBeCloseTo(0);
    expect(first.y).toBeCloseTo(-50);
  });

  it("collapses to the centre rather than dividing by a zero max", () => {
    for (const p of radarPoints([0, 0, 0], 0, 7, 9, 100)) {
      expect(p).toEqual({ x: 7, y: 9 });
    }
  });
});

describe("squarify", () => {
  const box = { w: 400, h: 300 };

  it("fills the box with areas in proportion", () => {
    const values = [40, 25, 15, 10, 6, 4];
    const rects = squarify(values, box.w, box.h);
    const total = values.reduce((s, v) => s + v, 0);
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo((values[i] / total) * box.w * box.h, 4);
    });
    const covered = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(covered).toBeCloseTo(box.w * box.h, 4);
  });

  it("keeps every rectangle inside the box", () => {
    for (const r of squarify([30, 20, 20, 15, 10, 5], box.w, box.h)) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(box.w + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(box.h + 1e-9);
    }
  });

  it("does not overlap", () => {
    const rects = squarify([28, 22, 18, 12, 10, 6, 4], box.w, box.h);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart =
          a.x + a.w <= b.x + 1e-9 ||
          b.x + b.w <= a.x + 1e-9 ||
          a.y + a.h <= b.y + 1e-9 ||
          b.y + b.h <= a.y + 1e-9;
        expect(apart).toBe(true);
      }
    }
  });

  it("beats slice-and-dice on the worst aspect ratio", () => {
    // The whole reason for the algorithm: a sliver carries no area
    // impression, so the shapes have to stay roughly square.
    const values = [40, 25, 15, 10, 6, 4];
    const worst = Math.max(
      ...squarify(values, box.w, box.h).map((r) => Math.max(r.w / r.h, r.h / r.w)),
    );
    expect(worst).toBeLessThan(3);
  });

  it("survives an empty or zero input", () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([0, 0], 100, 100)).toEqual([
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ]);
  });
});

