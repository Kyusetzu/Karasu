import { describe, expect, it } from "vitest";
import { GradientBars } from "./GradientBars";
import { html } from "@/test/markup";

/** Static markup needs no DOM, so the filename stays without `.dom`; the tests ask only what the output holds. */

describe("GradientBars", () => {
  const rows = [
    { label: "TV", value: 7.4, text: "7.4", sub: "120×" },
    { label: "Movie", value: 8.1, text: "8.1", sub: "14×" },
  ];

  it("writes every label, value and count in the flow of the page", () => {
    const markup = html(<GradientBars title="t" rows={rows} />);
    for (const r of rows) {
      expect(markup).toContain(r.label);
      expect(markup).toContain(r.text);
      expect(markup).toContain(r.sub);
    }
  });

  it("fills through a theme-following SVG gradient, never a literal colour", () => {
    const markup = html(<GradientBars title="t" rows={rows} />);
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain("var(--color-accent-600)");
    expect(markup).toContain("var(--color-accent-400)");
    expect(markup).not.toMatch(/(?:fill|stop-color)="#/);
  });

  it("a pinned domain keeps a 7.4 from reading as a landslide over a 7.1", () => {
    // The bar is its share of the pinned domain, not the full width a data-relative scale would give it.
    const markup = html(
      <GradientBars title="t" domain={10} rows={[{ label: "TV", value: 7.4, text: "7.4" }]} />,
    );
    expect(markup).toContain('width="74"');
  });

  it("renders nothing for an empty list", () => {
    expect(html(<GradientBars title="t" rows={[]} />)).toBe("");
  });
});
