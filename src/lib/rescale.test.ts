import { describe, expect, it } from "vitest";
import { planRescale } from "./rescale";

const e = (id: number, score: number) => ({ id, mediaId: id, score });

describe("planRescale", () => {
  it("maps linearly from the source range onto the target range", () => {
    const plan = planRescale(
      [e(1, 5), e(2, 8), e(3, 6.5)],
      { min: 5, max: 8 },
      { min: 3, max: 9 },
      "POINT_10",
    );
    // 5→3, 8→9, 6.5→6.
    expect(plan.groups.map((g) => g.score)).toEqual([3, 6, 9]);
    expect(plan.affected).toBe(3);
    expect(plan.requests).toBe(3);
  });

  it("snaps to the format's step — decimals keep theirs, integers lose them", () => {
    const decimal = planRescale([e(1, 7)], { min: 1, max: 10 }, { min: 1, max: 9.5 }, "POINT_10_DECIMAL");
    // 7 → 1 + 6/9*8.5 = 6.666… → 6.7 on the 0.1 step.
    expect(decimal.groups[0].score).toBeCloseTo(6.7, 5);
    // On the integer step the same map snaps back to 7 — no change, no group.
    const integer = planRescale([e(1, 7)], { min: 1, max: 10 }, { min: 1, max: 9.5 }, "POINT_10");
    expect(integer.affected).toBe(0);
    expect(integer.groups).toEqual([]);
  });

  it("never touches unscored entries or scores outside the source range", () => {
    const plan = planRescale(
      [e(1, 0), e(2, 3), e(3, 9)],
      { min: 5, max: 10 },
      { min: 1, max: 5 },
      "POINT_10",
    );
    expect(plan.untouched).toBe(2);
    expect(plan.affected).toBe(1);
  });

  it("drops entries whose raw score would not change", () => {
    const plan = planRescale([e(1, 7)], { min: 1, max: 10 }, { min: 1, max: 10 }, "POINT_10");
    expect(plan.affected).toBe(0);
    expect(plan.untouched).toBe(1);
    expect(plan.groups).toEqual([]);
  });

  it("groups by target score and chunks requests at fifty ids", () => {
    const entries = Array.from({ length: 120 }, (_, i) => e(i + 1, 8));
    const plan = planRescale(entries, { min: 1, max: 10 }, { min: 1, max: 5 }, "POINT_10");
    // All 120 land on one score (8 → 4) but cost three chunked requests.
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].score).toBe(4);
    expect(plan.requests).toBe(3);
  });

  it("a degenerate source range maps everything to the target minimum", () => {
    const plan = planRescale([e(1, 7), e(2, 7)], { min: 7, max: 7 }, { min: 5, max: 9 }, "POINT_10");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].score).toBe(5);
  });

  it("clamps to the scale and floors at one step — a rescale cannot unscore", () => {
    const plan = planRescale([e(1, 1)], { min: 1, max: 10 }, { min: 0, max: 0.2 }, "POINT_10");
    expect(plan.groups[0]?.score ?? 1).toBeGreaterThanOrEqual(1);
  });
});
