import { describe, expect, it } from "vitest";
import { previewMapping, splitMapping } from "./seasonSplit";

describe("splitMapping", () => {
  it("renumbers a range from the destination start", () => {
    expect(splitMapping(13, 15, 1)).toEqual([
      { disk: 13, renumbered: 1 },
      { disk: 14, renumbered: 2 },
      { disk: 15, renumbered: 3 },
    ]);
  });

  it("supports a destination that does not start at 1 — the community rules do", () => {
    expect(splitMapping(25, 26, 13)).toEqual([
      { disk: 25, renumbered: 13 },
      { disk: 26, renumbered: 14 },
    ]);
  });

  it("a single-episode split is a mapping of one", () => {
    expect(splitMapping(13, 13, 1)).toEqual([{ disk: 13, renumbered: 1 }]);
  });

  it("refuses nonsense rather than mapping it", () => {
    expect(splitMapping(15, 13, 1)).toEqual([]);
    expect(splitMapping(0, 5, 1)).toEqual([]);
    expect(splitMapping(1, 5, 0)).toEqual([]);
  });
});

describe("previewMapping", () => {
  it("shows everything when the range is short", () => {
    const p = previewMapping(13, 16, 1);
    expect(p.shown).toHaveLength(4);
    expect(p.hidden).toBe(0);
    expect(p.last).toBeNull();
  });

  it("collapses a long range to head … last", () => {
    const p = previewMapping(13, 24, 1);
    expect(p.shown.map((x) => x.disk)).toEqual([13, 14, 15]);
    expect(p.hidden).toBe(8);
    expect(p.last).toEqual({ disk: 24, renumbered: 12 });
  });

  it("the collapsed pieces account for every episode exactly once", () => {
    const p = previewMapping(13, 24, 1);
    expect(p.shown.length + p.hidden + 1).toBe(splitMapping(13, 24, 1).length);
  });
});
