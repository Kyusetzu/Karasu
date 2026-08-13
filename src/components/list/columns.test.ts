import { describe, expect, it } from "vitest";
import {
  cellWidth,
  COLUMN_PX,
  fixedWidth,
  minRowWidth,
  ROW_HEIGHT_PX,
  SCORE_SHOWS_STAR,
  shows,
  templateColumns,
  tierForWidth,
  TITLE_MIN_PX,
  WORST_CASE,
  type RowShape,
  type Tier,
} from "./columns";

const TIERS: Tier[] = ["compact", "mid", "full"];
const shape = (over: Partial<RowShape> = {}): RowShape => ({
  tier: "full",
  selectMode: false,
  manga: false,
  ...over,
});

/**
 * The point of all of this: a fixed column width nobody checked against the
 * widest value it can hold is exactly how the old row clipped every double-digit
 * score and every long-series progress. The widths are only trustworthy while
 * something asserts they still fit.
 */
describe("cellWidth", () => {
  it("leaves room for the text, its padding and some headroom", () => {
    expect(cellWidth(2)).toBeGreaterThan(2 * 7.2 + 16);
  });

  /**
   * The bug in one assertion: a native select spends part of its content box on
   * the arrow, so a control needs more than the same text in a span.
   */
  it("gives a select more room than a plain cell", () => {
    expect(cellWidth(4, true)).toBeGreaterThan(cellWidth(4, false) + 12);
  });

  it("stays on the 4px spacing scale and never shrinks", () => {
    let previous = 0;
    for (let chars = 1; chars <= 14; chars++) {
      expect(cellWidth(chars) % 4).toBe(0);
      expect(cellWidth(chars, true) % 4).toBe(0);
      expect(cellWidth(chars)).toBeGreaterThanOrEqual(previous);
      previous = cellWidth(chars);
    }
  });
});

describe("column widths fit their worst case", () => {
  /** The reported bug: `10` is the only two-digit score and it did not fit. */
  it("fits a double-digit score, with room the old cell did not have", () => {
    expect(COLUMN_PX.score).toBeGreaterThanOrEqual(
      cellWidth(WORST_CASE.score.length, true),
    );
    // 52px is what `w-13` was, and what clipped.
    expect(COLUMN_PX.score).toBeGreaterThan(52);
  });

  /**
   * Scores render in the account's format now, so the worst case is the widest
   * across all five: `10.0` (POINT_10_DECIMAL) — one character more than `100`.
   */
  it("covers the widest rendering of every score format", () => {
    expect(WORST_CASE.score.length).toBeGreaterThanOrEqual("10.0".length);
  });

  /** Older and unreported: `1100 / 1100` in a 72px cell. */
  it("fits the longest progress string", () => {
    expect(COLUMN_PX.progress).toBeGreaterThanOrEqual(
      cellWidth(WORST_CASE.progress.length, true),
    );
    expect(COLUMN_PX.progress).toBeGreaterThan(72);
  });

  it("fits volumes and a repeat count", () => {
    expect(COLUMN_PX.volumes).toBeGreaterThanOrEqual(
      cellWidth(WORST_CASE.volumes.length, true),
    );
    expect(COLUMN_PX.repeat).toBeGreaterThanOrEqual(
      cellWidth(WORST_CASE.repeat.length),
    );
  });

  /**
   * Dropping the star from the closed display is what buys the score cell its
   * room back. If it ever returns, the worst case grows by two characters and
   * the width above is wrong again.
   */
  it("keeps the star out of the closed score display", () => {
    expect(SCORE_SHOWS_STAR).toBe(false);
    expect(WORST_CASE.score).not.toContain("★");
  });
});

describe("templateColumns", () => {
  const trackCount = (s: string) => s.trim().split(/\s+(?![^(]*\))/).length;

  /**
   * The track count must be constant across every shape, or the header and the
   * rows stop describing the same columns the moment a tier changes.
   */
  it("has the same number of tracks for every shape", () => {
    const counts = new Set<number>();
    for (const tier of TIERS)
      for (const selectMode of [false, true])
        for (const manga of [false, true])
          counts.add(trackCount(templateColumns({ tier, selectMode, manga })));
    expect([...counts]).toHaveLength(1);
  });

  /**
   * A zero-width track rather than a removed one: dropping a column on entering
   * select mode would shift every other column sideways, which is the opposite
   * of what you want while picking rows out of a table.
   */
  it("keeps the selection track present but collapsed when not selecting", () => {
    expect(templateColumns(shape({ selectMode: false }))).toMatch(/^0px /);
    expect(templateColumns(shape({ selectMode: true }))).toMatch(/^24px /);
  });

  it("opens the volumes track only for manga, and only where the tier keeps it", () => {
    expect(templateColumns(shape({ manga: true }))).toContain(
      `${COLUMN_PX.volumes}px`,
    );
    expect(templateColumns(shape({ manga: false }))).not.toContain(
      `${COLUMN_PX.volumes}px`,
    );
    // compact gives up volumes even on manga.
    expect(
      templateColumns(shape({ manga: true, tier: "compact" })),
    ).not.toContain(`${COLUMN_PX.volumes}px`);
  });

  /**
   * `minmax(0, 1fr)`, not `1fr`. A `1fr` track's minimum is its content, so a
   * long title would push every fixed column off the right edge instead of
   * truncating.
   */
  it("lets the title truncate rather than push the columns out", () => {
    expect(templateColumns(shape())).toContain("minmax(0, 1fr)");
    expect(templateColumns(shape())).not.toMatch(/(^| )1fr( |$)/);
  });
});

describe("tiers", () => {
  it("give up columns monotonically as they narrow", () => {
    for (const col of ["tags", "dates", "repeat", "status", "volumes"] as const) {
      const kept = TIERS.filter((tier) => shows(tier, col));
      // Whatever a narrower tier keeps, a wider one keeps too.
      if (kept.includes("compact")) expect(kept).toContain("mid");
      if (kept.includes("mid")) expect(kept).toContain("full");
    }
  });

  it("get narrower in order", () => {
    let previous = 0;
    for (const tier of TIERS) {
      const w = fixedWidth(shape({ tier }));
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });
});

describe("tierForWidth", () => {
  /**
   * The reason tiers exist: the full set is ~1100px of fixed tracks and the
   * window minimum leaves far less, and a fixed track overflows rather than
   * shrinking.
   */
  it("picks a tier that actually fits", () => {
    for (const available of [560, 668, 820, 968, 1288, 1600, 2400]) {
      for (const manga of [false, true]) {
        const tier = tierForWidth(available, manga);
        if (tier !== "compact") {
          expect(
            minRowWidth({ tier, selectMode: true, manga }),
          ).toBeLessThanOrEqual(available);
        }
      }
    }
  });

  it("never widens as the space narrows", () => {
    const rank = { compact: 0, mid: 1, full: 2 } as const;
    for (const manga of [false, true]) {
      let previous = -1;
      for (let w = 400; w <= 2600; w += 20) {
        const r = rank[tierForWidth(w, manga)];
        expect(r).toBeGreaterThanOrEqual(previous);
        previous = r;
      }
    }
  });

  /**
   * The app's window minimum is 940px wide with a 208px sidebar and 2rem of page
   * padding either side — so this is the real floor a row has to survive, in
   * select mode, on manga (the widest shape).
   */
  it("fits inside the smallest window the app allows", () => {
    const available = 940 - 208 - 64;
    const tier = tierForWidth(available, true);
    expect(
      minRowWidth({ tier, selectMode: true, manga: true }),
    ).toBeLessThanOrEqual(available);
  });
});

describe("ROW_HEIGHT_PX", () => {
  /**
   * Feeds `estimateRowHeight`. The virtualizer measures the real height after
   * mount, so a wrong value here is not a broken layout — it is a scrollbar that
   * visibly resizes while you scroll, which is why it is derived from the cover
   * rather than typed in twice.
   */
  it("is the cover at 2:3 plus padding, and taller than the old row", () => {
    expect(ROW_HEIGHT_PX).toBe(Math.round(COLUMN_PX.cover * 1.5) + 16);
    expect(ROW_HEIGHT_PX).toBeGreaterThan(78);
  });
});

describe("TITLE_MIN_PX", () => {
  it("is wide enough to be worth showing", () => {
    expect(TITLE_MIN_PX).toBeGreaterThanOrEqual(120);
  });
});
