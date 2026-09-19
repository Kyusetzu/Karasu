import { describe, expect, it } from "vitest";
import { DotPlot } from "./DotPlot";
import { html } from "@/test/markup";

/** Static markup needs no DOM, so the filename stays without `.dom`; the tests ask only what the output holds. */

describe("DotPlot", () => {
  const rows = [
    { label: "Hidden Gem", mine: 9.5, other: 6.2 },
    { label: "Overrated", mine: 4, other: 8.6 },
  ];

  it("writes each row's pair as text, not only as geometry", () => {
    const markup = html(
      <DotPlot title="t" rows={rows} legendMine="mine" legendOther="crowd" />,
    );
    expect(markup).toContain("Hidden Gem");
    expect(markup).toContain("6.2");
    expect(markup).toContain("9.5");
    expect(markup).toContain("mine");
    expect(markup).toContain("crowd");
  });

  it("keeps both dots on the theme's palette", () => {
    const markup = html(
      <DotPlot title="t" rows={rows} legendMine="m" legendOther="c" />,
    );
    expect(markup).toContain("var(--color-accent-400)");
    expect(markup).toContain("var(--color-graph-none)");
    expect(markup).not.toMatch(/fill="#/);
  });

  it("renders nothing for an empty list", () => {
    expect(html(<DotPlot title="t" rows={[]} legendMine="m" legendOther="c" />)).toBe("");
  });
});
