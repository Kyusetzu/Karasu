import { describe, expect, it } from "vitest";
import { AreaChart } from "./AreaChart";
import { html, texts } from "@/test/markup";

/** Static markup needs no DOM, so the filename stays without `.dom`; the tests ask only what the output holds. */

describe("AreaChart", () => {
  const data = [
    { label: "2021", value: 42 },
    { label: "2022", value: 17 },
    { label: "2023", value: 88 },
  ];

  it("writes every point's value and label, like the line it succeeds", () => {
    const out = texts(html(<AreaChart data={data} />));
    for (const d of data) {
      expect(out).toContain(String(d.value));
      expect(out).toContain(d.label);
    }
  });

  it("draws a curve, not a polyline, and keeps the theme's palette", () => {
    const markup = html(<AreaChart data={data} />);
    // curveMonotoneX emits cubic segments — a C in the path is the curve.
    expect(markup).toMatch(/<path[^>]*d="[^"]*C/);
    expect(markup).toContain("var(--color-accent-500)");
    expect(markup).toContain("rgba(var(--accent-rgb)");
    expect(markup).not.toMatch(/(?:fill|stroke)="#/);
  });

  it("normalizes the draw-on with pathLength, since a curve's length is not knowable in markup", () => {
    expect(html(<AreaChart data={data} />)).toContain('pathLength="1"');
  });

  it("declines a single point — one dot is not a series", () => {
    expect(html(<AreaChart data={[{ label: "2024", value: 3 }]} />)).toBe("");
  });
});
