import { describe, expect, it } from "vitest";
import {
  FORMAT_ORDER,
  flattenGroups,
  groupByFormat,
  nextFocusGrouped,
} from "./formatGroups";

const of = (...formats: (string | null)[]) => formats.map((format, i) => ({ id: i, format }));

describe("groupByFormat", () => {
  it("uses the reading order, not the order they arrived in", () => {
    const groups = groupByFormat(of("MUSIC", "MOVIE", "TV", "OVA"));
    expect(groups.map((g) => g.format)).toEqual(["TV", "MOVIE", "OVA", "MUSIC"]);
  });

  /** A heading over nothing is worse than no heading. */
  it("drops the formats this season has none of", () => {
    const groups = groupByFormat(of("TV", "TV"));
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  /**
   * `Media.format` is `string | null`, not a union — AniList can grow one and
   * a title with it must land somewhere rather than disappearing from a page
   * that claims to show the season.
   */
  it("keeps a format it has never heard of, at the end", () => {
    const groups = groupByFormat(of("TV", "HOLOGRAM", null));
    expect(groups.map((g) => g.format)).toEqual(["TV", null]);
    expect(groups[1].items.map((i) => i.format)).toEqual(["HOLOGRAM", null]);
  });

  it("offsets index into the flattened order", () => {
    const groups = groupByFormat(of("TV", "MOVIE", "TV", "MOVIE", "OVA"));
    for (const g of groups) {
      expect(flattenGroups(groups)[g.offset]).toBe(g.items[0]);
    }
    expect(flattenGroups(groups)).toHaveLength(5);
  });

  it("handles an empty season", () => {
    expect(groupByFormat([])).toEqual([]);
    expect(flattenGroups([])).toEqual([]);
  });

  /** Everything in `FORMAT_ORDER` has to be a format the app can label. */
  it("orders every format it claims to know", () => {
    expect(new Set(FORMAT_ORDER).size).toBe(FORMAT_ORDER.length);
  });
});

describe("nextFocusGrouped", () => {
  // Two sections: 5 items then 3, at 3 columns.
  //   A: 0 1 2 / 3 4        B: 5 6 7
  const sizes = [5, 3];

  it("starts at the first item whichever way it was pressed", () => {
    expect(nextFocusGrouped(null, "down", 3, sizes)).toBe(0);
    expect(nextFocusGrouped(null, "up", 3, sizes)).toBe(0);
  });

  it("runs left and right straight through the sections", () => {
    expect(nextFocusGrouped(4, "right", 3, sizes)).toBe(5);
    expect(nextFocusGrouped(5, "left", 3, sizes)).toBe(4);
    // And clamps rather than wrapping, at both ends.
    expect(nextFocusGrouped(0, "left", 3, sizes)).toBe(0);
    expect(nextFocusGrouped(7, "right", 3, sizes)).toBe(7);
  });

  it("moves a row at a time inside a section", () => {
    expect(nextFocusGrouped(0, "down", 3, sizes)).toBe(3);
    expect(nextFocusGrouped(3, "up", 3, sizes)).toBe(0);
  });

  /**
   * The bug a flat `nextFocus` has here: from index 2 (`A` row 1, column 2)
   * `2 + 3 = 5` lands in section B, skipping A's second row entirely. A ragged
   * last row has to be visited before leaving the section.
   */
  it("does not skip a ragged last row on the way out", () => {
    expect(nextFocusGrouped(2, "down", 3, sizes)).toBe(4);
  });

  it("crosses into the next section keeping its column", () => {
    // From A's last row (3, 4) down into B (5, 6, 7).
    expect(nextFocusGrouped(3, "down", 3, sizes)).toBe(5);
    expect(nextFocusGrouped(4, "down", 3, sizes)).toBe(6);
  });

  it("crosses back into the previous section's last row", () => {
    expect(nextFocusGrouped(5, "up", 3, sizes)).toBe(3);
    expect(nextFocusGrouped(6, "up", 3, sizes)).toBe(4);
    // Column 2 has no item in A's ragged last row, so it takes the nearest.
    expect(nextFocusGrouped(7, "up", 3, sizes)).toBe(4);
  });

  it("stops at the outer edges instead of wrapping", () => {
    expect(nextFocusGrouped(0, "up", 3, sizes)).toBe(0);
    expect(nextFocusGrouped(7, "down", 3, sizes)).toBe(7);
  });

  /** A section shorter than one row is a real case — one movie in a season. */
  it("handles a section of one", () => {
    const s = [3, 1, 3];
    expect(nextFocusGrouped(0, "down", 3, s)).toBe(3);
    expect(nextFocusGrouped(3, "down", 3, s)).toBe(4);
    expect(nextFocusGrouped(4, "up", 3, s)).toBe(3);
  });

  it("survives a column count that has not been measured yet", () => {
    // `useColumnCount` returns 1 until layout resolves.
    expect(nextFocusGrouped(0, "down", 1, sizes)).toBe(1);
    expect(nextFocusGrouped(0, "down", 0, sizes)).toBe(1);
  });

  it("returns null when there is nothing to focus", () => {
    expect(nextFocusGrouped(null, "down", 3, [])).toBeNull();
    expect(nextFocusGrouped(0, "down", 3, [0, 0])).toBeNull();
  });
});
