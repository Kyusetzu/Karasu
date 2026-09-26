import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";
import { DayHeatmap } from "./DayHeatmap";
import { dayHeatmapFromHistory } from "@/lib/localStats";
import { html } from "@/test/markup";

/** Static markup needs no DOM, so the filename stays without `.dom`; the tests ask only what the output holds. */

describe("Heatmap", () => {
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const years = [
    { year: 2023, months: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 5] },
    { year: 2024, months: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ];

  it("labels every year and month, and titles each busy cell with its count", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("2023");
    expect(markup).toContain("2024");
    expect(markup).toContain("M 2023 · 2");
    expect(markup).toContain("D 2023 · 5");
  });

  it("scales intensity through the accent variable, never a literal colour", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("rgba(var(--accent-rgb)");
    expect(markup).not.toMatch(/background:#/);
    // The busiest cell gets more alpha than the quietest.
    expect(markup).toContain("0.92");
    expect(markup).toContain("0.14");
  });

  it("an empty month keeps the surface tone — quiet, not missing", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("bg-surface-800");
  });

  it("renders nothing with no years", () => {
    expect(html(<Heatmap title="t" years={[]} max={0} monthLabels={months} />)).toBe("");
  });
});

describe("DayHeatmap", () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
  const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const grid = dayHeatmapFromHistory([
    { date: day("2026-01-05"), amount: 4, level: 3 },
    { date: day("2026-01-11"), amount: 9, level: 9 },
  ])!;

  const markup = html(
    <DayHeatmap
      title="Days at the list"
      data={grid}
      monthLabels={MONTHS}
      dayLabels={DAYS}
      formatDay={(d) => new Date(d * 1000).toISOString().slice(0, 10)}
      rangeLabel="2026-01-05 – 2026-01-11 · 13 actions"
      legendLess="Less"
      legendMore="More"
    />,
  );

  /** The count is the assertion: a week is seven cells whether or not anything happened in them. */
  it("draws every day in the range, not only the busy ones", () => {
    expect(markup.match(/rounded-mark/g) ?? []).toHaveLength(12);
  });

  /** The legend is never hover-only: the range with its total and one swatch per intensity bucket. */
  it("spells out the range and one swatch per bucket", () => {
    expect(markup).toContain("2026-01-05 – 2026-01-11 · 13 actions");
    expect(markup).toContain("Less");
    expect(markup).toContain("More");
    for (const a of [0.14, 0.32, 0.5, 0.7, 0.92]) {
      expect(markup).toContain(`rgba(var(--accent-rgb), ${a})`);
    }
  });

  /** No column may hold a month label inside the day rows, or the cells drift off their weekday labels. */
  it("gives every column the same h-3 label band", () => {
    expect(markup).not.toContain("grid-rows-7");
  });

  /** A day cell has no room for its count, so it lives in `title` with the date spelled out. */
  it("names the day and its count on each busy cell", () => {
    expect(markup).toContain("2026-01-05 · 4");
    expect(markup).toContain("2026-01-11 · 9");
  });

  /** An empty grid renders nothing rather than an axis with no cells. */
  it("renders nothing when there are no weeks", () => {
    expect(
      html(
        <DayHeatmap
          title="x"
          data={{ weeks: [], months: [], total: 0, from: 0, to: 0 }}
          monthLabels={MONTHS}
          dayLabels={DAYS}
          formatDay={() => ""}
          rangeLabel=""
          legendLess="Less"
          legendMore="More"
        />,
      ),
    ).toBe("");
  });
});
